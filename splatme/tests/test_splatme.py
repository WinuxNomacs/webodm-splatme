"""
Tests of the SplatMe plugin: it registers.
"""
from app.plugins import get_plugin_by_name
from app.tests.classes import BootTestCase


class TestSplatMe(BootTestCase):
    def test_the_plugin_is_registered_and_active(self):
        plugin = get_plugin_by_name("splatme")
        self.assertIsNotNone(plugin)
        self.assertEqual(plugin.get_manifest()["name"], "SplatMe")
