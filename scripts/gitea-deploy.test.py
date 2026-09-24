"""Offline failure-path tests. No registry, SSH host, or credentials required."""
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parent
SHA = "a" * 40


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.env = {
            **os.environ,
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "SOURCE_SHA": SHA,
            "GITHUB_SERVER_URL": "https://git.subcult.tv",
            "GITHUB_REPOSITORY": "subculture-collective/patchwork",
            "FIXTURES": str(self.root),
        }
        self.status = {
            "sha": SHA, "total_count": 2,
            "statuses": [
                {"context": f"CI / {job} (push)", "status": "success",
                 "target_url": f"/subculture-collective/patchwork/actions/runs/42/jobs/{i}"}
                for i, job in enumerate(["quality-gates", "e2e-production"], 1)
            ],
        }
        self.executable(self.bin / "curl", """#!/usr/bin/env bash
set -euo pipefail
[[ ${CURL_FAIL:-false} != true ]] || exit 22
case "${!#}" in
  */branches/main) cat "$FIXTURES/branch.json" ;;
  */status?limit=100) cat "$FIXTURES/status.json" ;;
  *) exit 90 ;;
esac
""")
        (self.root / "branch.json").write_text(json.dumps({"commit": {"id": SHA}}))

    def executable(self, path, text):
        path.write_text(text)
        path.chmod(0o755)

    def run_script(self, name, *args):
        return subprocess.run(
            ["bash", str(SCRIPTS / name), *args], cwd=self.root, env=self.env,
            capture_output=True, text=True, timeout=10,
        )

    def source_result(self, expected=0):
        (self.root / "status.json").write_text(json.dumps(self.status))
        result = self.run_script("verify-gitea-source.sh")
        if expected == 0:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0)

    def test_same_run_success(self):
        self.source_result()

    def test_non_success_gates(self):
        for state in ["pending", "failure", "error", "skipped", "cancelled"]:
            with self.subTest(state=state):
                self.status["statuses"][0]["status"] = state
                self.source_result(1)

    def test_missing_duplicate_and_pr_statuses(self):
        original = copy.deepcopy(self.status)
        for mode in ["missing", "duplicate", "pull_request"]:
            with self.subTest(mode=mode):
                self.status = copy.deepcopy(original)
                if mode == "missing":
                    self.status["statuses"].pop()
                elif mode == "duplicate":
                    self.status["statuses"].append(self.status["statuses"][0])
                else:
                    self.status["statuses"][0]["context"] = "CI / quality-gates (pull_request)"
                self.status["total_count"] = len(self.status["statuses"])
                self.source_result(1)

    def test_different_runs(self):
        self.status["statuses"][0]["target_url"] = self.status["statuses"][0]["target_url"].replace("/42/", "/41/")
        self.source_result(1)

    def test_foreign_status_url(self):
        self.status["statuses"][0]["target_url"] = "https://evil.test" + self.status["statuses"][0]["target_url"]
        self.source_result(1)

    def test_absolute_gitea_status_url(self):
        self.status["statuses"][0]["target_url"] = "https://git.subcult.tv" + self.status["statuses"][0]["target_url"]
        self.source_result()

    def test_wrong_response_sha(self):
        self.status["sha"] = "b" * 40
        self.source_result(1)

    def test_truncated_statuses(self):
        self.status["total_count"] = 101
        self.source_result(1)

    def test_old_main(self):
        (self.root / "branch.json").write_text(json.dumps({"commit": {"id": "b" * 40}}))
        self.source_result(1)

    def test_invalid_sha(self):
        self.env["SOURCE_SHA"] = "main; echo unsafe"
        self.source_result(1)

    def test_api_failure(self):
        self.env["CURL_FAIL"] = "true"
        self.source_result(1)

    def test_malformed_api_response(self):
        (self.root / "branch.json").write_text("<html>login</html>")
        self.source_result(1)

    def valid_config(self):
        for key in """STAGING_REGISTRY_USERNAME STAGING_REGISTRY_TOKEN
            STAGING_COSIGN_PRIVATE_KEY STAGING_COSIGN_PASSWORD STAGING_COSIGN_PUBLIC_KEY
            STAGING_SSH_PRIVATE_KEY STAGING_SSH_KNOWN_HOSTS
            STAGING_E2E_REQUESTER_STATE_B64 STAGING_E2E_HELPER_STATE_B64
            STAGING_E2E_MAINTAINER_STATE_B64 STAGING_E2E_EXACT_LATITUDE
            STAGING_E2E_EXACT_LONGITUDE STAGING_E2E_PRIVATE_MARKER
            STAGING_ARTIFACT_REDACTION_TERMS""".split():
            self.env[key] = "fixture-do-not-log"
        self.env.update(
            STAGING_SSH_USER="deploy", STAGING_SSH_HOST="staging.test",
            STAGING_SSH_USE_SUDO="false", STAGING_COMPOSE_OVERRIDE_FILE="",
            STAGING_DEPLOY_PATH="/srv/patchwork", STAGING_ENV_FILE="/etc/patchwork/runtime.env",
            STAGING_COSIGN_PUBLIC_KEY_PATH="/etc/patchwork/cosign.pub",
            STAGING_COMPOSE_PROJECT_NAME="existing-staging",
            STAGING_PUBLIC_ORIGIN="https://staging.test",
            STAGING_VITE_API_BASE_URL="/api",
            STAGING_VITE_MAP_TILE_URL=f"/tiles/us.{'b' * 64}.pmtiles",
        )

    def test_configuration_accepts_supported_urls(self):
        self.valid_config()
        for value in ["/api", "https://api.staging.test", "https://api.staging.test:8443/api"]:
            self.env["STAGING_VITE_API_BASE_URL"] = value
            result = self.run_script("check-staging-workflow-config.sh")
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_missing_secret_is_named_but_never_printed(self):
        self.valid_config()
        self.env["STAGING_REGISTRY_TOKEN"] = ""
        result = self.run_script("check-staging-workflow-config.sh")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("STAGING_REGISTRY_TOKEN", result.stderr)
        self.assertNotIn("fixture-do-not-log", result.stdout + result.stderr)

    def test_config_rejects_remote_shell_injection_and_unsafe_urls(self):
        for key, value in [
            ("STAGING_DEPLOY_PATH", "/srv/staging'; touch /tmp/nope; '"),
            ("STAGING_DEPLOY_PATH", "/srv/../etc"),
            ("STAGING_SSH_HOST", "-oProxyCommand=anything"),
            ("STAGING_VITE_API_BASE_URL", "//evil.test/api"),
            ("STAGING_PUBLIC_ORIGIN", "http://staging.test"),
            ("STAGING_VITE_MAP_TILE_URL", "/tiles/us.pmtiles"),
            ("STAGING_COMPOSE_PROJECT_NAME", "run/123"),
            ("STAGING_COMPOSE_OVERRIDE_FILE", "/etc/override;anything"),
            ("STAGING_SSH_USE_SUDO", "true;anything"),
        ]:
            with self.subTest(key=key):
                self.valid_config()
                self.env[key] = value
                self.assertNotEqual(self.run_script("check-staging-workflow-config.sh").returncode, 0)

    def release_setup(self):
        state = self.root / "state"
        state.mkdir()
        self.env.update(PATCHWORK_RELEASE_STATE_DIR=str(state), COMPOSE_PROJECT_NAME="existing-staging")
        current = state / "current-artifact-digests.json"
        current.write_text("current release")
        digest = subprocess.check_output(["sha256sum", str(current)], text=True)
        (state / "current-artifact-digests.json.sha256").write_text(digest)
        (state / "previous-artifact-digests.json").write_text("older release")
        self.executable(self.root / "verify-release-trust.sh", "#!/bin/bash\nexit ${TRUST_EXIT:-0}\n")
        self.executable(self.root / "deploy-staging-digests.sh", """#!/bin/bash
echo deploy >> calls
if [[ ${RETAIN:-true} == true ]]; then
    cp "$PATCHWORK_RELEASE_STATE_DIR/current-artifact-digests.json" "$PATCHWORK_RELEASE_STATE_DIR/previous-artifact-digests.json"
fi
exit ${DEPLOY_EXIT:-0}
""")
        self.executable(self.root / "rollback-staging-digests.sh", "#!/bin/bash\necho rollback >> calls\n")
        return state

    def test_success_does_not_rollback(self):
        self.release_setup()
        result = self.run_script("run-staging-release.sh", "runtime.env", "deploy.lock")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / "calls").read_text(), "deploy\n")

    def test_failed_deployment_rolls_back_matching_baseline(self):
        self.release_setup()
        self.env["DEPLOY_EXIT"] = "1"
        result = self.run_script("run-staging-release.sh", "runtime.env", "deploy.lock")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.root / "calls").read_text(), "deploy\nrollback\n")

    def test_rejected_trust_does_not_deploy_or_rollback(self):
        self.release_setup()
        self.env["TRUST_EXIT"] = "1"
        result = self.run_script("run-staging-release.sh", "runtime.env", "deploy.lock")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / "calls").exists())

    def test_stale_previous_is_not_used(self):
        self.release_setup()
        self.env.update(DEPLOY_EXIT="1", RETAIN="false")
        result = self.run_script("run-staging-release.sh", "runtime.env", "deploy.lock")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.root / "calls").read_text(), "deploy\n")

    def test_first_deployment_has_no_automatic_rollback(self):
        state = self.release_setup()
        (state / "current-artifact-digests.json").unlink()
        self.env.update(DEPLOY_EXIT="1", RETAIN="false")
        result = self.run_script("run-staging-release.sh", "runtime.env", "deploy.lock")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.root / "calls").read_text(), "deploy\n")

    def test_host_lock_rejects_concurrent_deploy(self):
        import fcntl
        self.release_setup()
        with (self.root / "deploy.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.run_script("run-staging-release.sh", "runtime.env", "deploy.lock")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / "calls").exists())

    def test_corrupt_current_baseline_stops_before_deploy(self):
        state = self.release_setup()
        (state / "current-artifact-digests.json").write_text("tampered manifest")
        result = self.run_script("run-staging-release.sh", "runtime.env", "deploy.lock")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / "calls").exists())


if __name__ == "__main__":
    unittest.main()
