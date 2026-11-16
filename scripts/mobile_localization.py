"""Validate and export the small native localization handoff fixture, not all app copy."""

import argparse
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / "docs/localization/seed.json"
EXAMPLES = ROOT / "docs/localization/examples"
ARGUMENT = re.compile(r"\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}")
CATEGORIES = {"zero", "one", "two", "few", "many", "other"}


def android_name(key: str) -> str:
    name = re.sub(r"(?<!^)(?=[A-Z])", "_", key).replace(".", "_").lower()
    if not re.fullmatch(r"[a-z][a-z0-9_]*", name):
        raise ValueError(f"Invalid Android resource identifier for {key}")
    return name


def validate(seed: dict) -> None:
    locales = seed["locales"]
    if seed["source_language"] not in locales or len(set(locales)) != len(locales):
        raise ValueError("Declare unique locales including the source language")
    if any(not re.fullmatch(r"[a-z]{2,3}", locale) for locale in locales):
        raise ValueError("This seed exporter supports language-only tags; map region tags in native foundations")
    keys, names = set(), set()
    for message in seed["messages"]:
        key = message["key"]
        name = android_name(key)
        if key in keys or name in names:
            raise ValueError(f"Duplicate key or Android-name collision: {key}")
        keys.add(key)
        names.add(name)
        if not message.get("context"):
            raise ValueError(f"Missing translator context: {key}")
        args = message["arguments"]
        if any(kind not in {"string", "integer"} for kind in args.values()):
            raise ValueError(f"Unsupported argument type: {key}")
        plural = message["plural_argument"]
        if plural and (args.get(plural) != "integer" or next(iter(args)) != plural):
            raise ValueError(f"The plural quantity must be the first integer argument: {key}")
        translations = message["translations"]
        if set(translations) != set(locales):
            raise ValueError(f"Missing or unregistered locale: {key}")
        for locale, variants in translations.items():
            if (plural and ("other" not in variants or not set(variants) <= CATEGORIES)) or (
                not plural and set(variants) != {"value"}
            ):
                raise ValueError(f"Invalid or incomplete variants: {key}/{locale}")
            for value in variants.values():
                found = set(ARGUMENT.findall(value))
                required = set(args) - ({plural} if plural else set())
                if not required <= found or not found <= set(args):
                    raise ValueError(f"Placeholder mismatch: {key}/{locale}")
                remainder = ARGUMENT.sub("", value)
                if "{{" in remainder or "}}" in remainder:
                    raise ValueError(f"Unsupported interpolation syntax: {key}/{locale}")
            if not message["translatable"] and variants != translations[seed["source_language"]]:
                raise ValueError(f"Non-translatable copy changed: {key}/{locale}")


def formatted(value: str, arguments: dict, platform: str) -> str:
    positions = {name: index for index, name in enumerate(arguments, 1)}
    def replace(match: re.Match) -> str:
        name = match.group(1)
        kind = arguments[name]
        specifier = ("lld" if kind == "integer" else "@") if platform == "ios" else (
            "d" if kind == "integer" else "s"
        )
        return f"%{positions[name]}${specifier}"
    rendered = ARGUMENT.sub(replace, value.replace("%", "%%"))
    if platform == "android":
        rendered = rendered.replace("\\", "\\\\").replace("'", "\\'").replace('"', '\\"')
        rendered = rendered.replace("\n", "\\n").replace("\t", "\\t")
        if rendered.startswith(("@", "?")):
            rendered = "\\" + rendered
    return rendered


def resources(seed: dict) -> dict[str, str]:
    validate(seed)
    catalog = {"sourceLanguage": seed["source_language"], "strings": {}, "version": "1.0"}
    android = {locale: ET.Element("resources") for locale in seed["locales"]}
    for message in seed["messages"]:
        entry = {"comment": message["context"], "extractionState": "manual", "localizations": {}}
        if not message["translatable"]:
            entry["shouldTranslate"] = False
        for locale, variants in message["translations"].items():
            if not message["translatable"] and locale != seed["source_language"]:
                continue
            ios = {quantity: {"stringUnit": {"state": "translated", "value": formatted(
                value, message["arguments"], "ios",
            )}} for quantity, value in variants.items()}
            entry["localizations"][locale] = {"variations": {"plural": ios}} if message["plural_argument"] else ios["value"]
            attributes = {"name": android_name(message["key"])}
            if not message["translatable"]:
                attributes["translatable"] = "false"
            android[locale].append(ET.Comment(" " + message["context"].replace("--", "—") + " "))
            element = ET.SubElement(android[locale], "plurals" if message["plural_argument"] else "string", attributes)
            for quantity, value in variants.items():
                target = ET.SubElement(element, "item", {"quantity": quantity}) if message["plural_argument"] else element
                target.text = formatted(value, message["arguments"], "android")
        catalog["strings"][message["key"]] = entry
    output = {"ios/Localizable.xcstrings": json.dumps(catalog, indent=2, ensure_ascii=False) + "\n"}
    for locale, element in android.items():
        ET.indent(element)
        qualifier = "values" if locale == seed["source_language"] else f"values-{locale}"
        output[f"android/{qualifier}/strings.xml"] = ET.tostring(element, encoding="unicode") + "\n"
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if checked-in examples differ")
    parser.add_argument("--output", type=Path, default=EXAMPLES)
    args = parser.parse_args()
    try:
        exported = resources(json.loads(SEED.read_text(encoding="utf-8")))
        for relative, content in exported.items():
            path = args.output / relative
            if args.check:
                if not path.exists() or path.read_text(encoding="utf-8") != content:
                    raise ValueError(f"Example needs review/regeneration: {path}")
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
    except (ValueError, KeyError) as error:
        parser.exit(1, f"{error}\n")
    print(f"{'Checked' if args.check else 'Exported'} {len(exported)} native localization examples")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
