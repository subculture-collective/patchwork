import copy
import json
import unittest
import xml.etree.ElementTree as ET

import mobile_localization as mobile


class NativeLocalizationHandoffTests(unittest.TestCase):
    def setUp(self):
        self.seed = json.loads(mobile.SEED.read_text(encoding="utf-8"))

    def test_seed_preserves_current_web_copy_and_context(self):
        for locale in self.seed["locales"]:
            catalog = json.loads((mobile.ROOT / f"apps/web/src/i18n/{locale}.json").read_text())
            for message in self.seed["messages"]:
                for quantity, key in message["source_keys"].items():
                    value = catalog
                    for part in key.split("."):
                        value = value[part]
                    self.assertEqual(value, message["translations"][locale][quantity], key)
                self.assertTrue(message["context"])

    def test_export_round_trip_preserves_plural_and_argument_positions(self):
        output = mobile.resources(self.seed)
        ios = json.loads(output["ios/Localizable.xcstrings"])
        self.assertEqual(ios["strings"]["discovery.resultCount"]["localizations"]["es"]
                         ["variations"]["plural"]["other"]["stringUnit"]["value"], "%1$lld resultados")
        xml = ET.fromstring(output["android/values-es/strings.xml"])
        plural = xml.find("plurals[@name='dashboard_excerpt_place_count']/item[@quantity='other']")
        self.assertEqual(plural.text, "%1$d lugares públicos a menos de %2$s")
        self.assertIsNone(xml.find("string[@name='app_title']"))
        self.assertEqual(ios["strings"]["app.title"]["shouldTranslate"], False)
        for relative, content in output.items():
            self.assertEqual((mobile.EXAMPLES / relative).read_text(encoding="utf-8"), content)

    def test_translator_can_reorder_named_arguments(self):
        self.assertEqual(mobile.formatted("{{name}}: {{count}}", {"count": "integer", "name": "string"}, "ios"), "%2$@: %1$lld")
        self.assertEqual(mobile.formatted("{{name}}: {{count}}", {"count": "integer", "name": "string"}, "android"), "%2$s: %1$d")

    def test_literal_percent_quotes_and_xml_are_not_format_arguments(self):
        value = "It's 50% <ready> & \"safe\" for {{name}}"
        rendered = mobile.formatted(value, {"name": "string"}, "android")
        root = ET.Element("resources")
        ET.SubElement(root, "string", {"name": "example"}).text = rendered
        self.assertEqual(ET.fromstring(ET.tostring(root)).find("string").text, rendered)
        self.assertIn("50%%", rendered)
        self.assertIn("It\\'s", rendered)
        self.assertIn('\\"safe\\"', rendered)

    def test_missing_locale_is_rejected(self):
        del self.seed["messages"][1]["translations"]["es"]
        with self.assertRaisesRegex(ValueError, "Missing or unregistered locale"):
            mobile.resources(self.seed)

    def test_missing_plural_fallback_is_rejected(self):
        del self.seed["messages"][3]["translations"]["es"]["other"]
        with self.assertRaisesRegex(ValueError, "incomplete variants"):
            mobile.resources(self.seed)

    def test_wrong_placeholder_is_rejected(self):
        self.seed["messages"][2]["translations"]["es"]["value"] = "Detalles de {{unknown}}"
        with self.assertRaisesRegex(ValueError, "Placeholder mismatch"):
            mobile.resources(self.seed)

    def test_initial_languages_require_the_singular_plural_variant(self):
        del self.seed["messages"][3]["translations"]["es"]["one"]
        with self.assertRaisesRegex(ValueError, "incomplete variants"):
            mobile.resources(self.seed)

    def test_colliding_android_identifiers_are_rejected(self):
        collision = copy.deepcopy(self.seed["messages"][1])
        collision["key"] = "nav_map"
        self.seed["messages"].append(collision)
        with self.assertRaisesRegex(ValueError, "collision"):
            mobile.resources(self.seed)

    def test_nontranslatable_brand_cannot_change(self):
        self.seed["messages"][0]["translations"]["es"]["value"] = "Changed brand"
        with self.assertRaisesRegex(ValueError, "Non-translatable copy changed"):
            mobile.resources(self.seed)

    def test_additional_native_plural_categories_are_preserved(self):
        self.seed["messages"][3]["translations"]["es"]["many"] = "{{count}} resultados"
        output = mobile.resources(self.seed)
        root = ET.fromstring(output["android/values-es/strings.xml"])
        self.assertIsNotNone(root.find("plurals/item[@quantity='many']"))


if __name__ == "__main__":
    unittest.main()
