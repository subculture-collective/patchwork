import unittest
from inventory_public_sources import build_inventory, markdown


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.catalog = {'sources': {'cpl': {'name':'Library', 'url':'https://example.org/', 'retrievedAt':'2026-09-01', 'sha256':'a'*64}},
                        'resources':[{'id':'branch-1','sourceId':'cpl','state':'IL','category':'other','services':[], 'usualHours':'Closed until further notice'}]}
        self.policies={'reviewedAt':'2026-09-20','families':{'cpl':{'automation':'existing-review-only'}}}

    def test_runtime_category_and_excluded_count_without_mutation(self):
        r=build_inventory({'one.json':self.catalog},self.policies)
        self.assertEqual(r['categories'], {'library':1})
        self.assertEqual(r['excludedClosedCount'],1)
        self.assertEqual(self.catalog['resources'][0]['category'],'other')
        self.assertEqual(r['sources'][0]['metadata']['sha256'],'a'*64)
        self.assertIn('| unknown |',markdown(r))

    def test_missing_source_refuses_misleading_counts(self):
        self.catalog['resources'][0]['sourceId']='missing'
        with self.assertRaisesRegex(ValueError,'Missing source'):
            build_inventory({'one.json':self.catalog},self.policies)

    def test_duplicate_resource_refuses_double_counting(self):
        self.catalog['resources'].append(dict(self.catalog['resources'][0]))
        with self.assertRaisesRegex(ValueError,'Duplicate resource'):
            build_inventory({'one.json':self.catalog},self.policies)

    def test_duplicate_source_refuses_silent_evidence_overwrite(self):
        with self.assertRaisesRegex(ValueError,'Duplicate source'):
            build_inventory({'one.json':self.catalog,'two.json':self.catalog},self.policies)


if __name__=='__main__': unittest.main()
