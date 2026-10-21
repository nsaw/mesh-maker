"""Fast configuration/force-volume regressions; stdlib only, no Blender installation."""
import copy
import json
import math
from pathlib import Path
import tempfile
import unittest

from quartering_wind import validate_profile
from workflow import build_config, parse_args

HERE = Path(__file__).resolve().parent


class WorkflowTests(unittest.TestCase):
    def config(self, *extra, preset='silk-gathered'):
        return build_config(parse_args(['venus-de-milo-smk.glb', '--preset', preset, '--out', 'out',
            '--azimuth', '-45', '--scale', '8', '--pose', str(HERE/'venus-de-milo-pose.json'), *extra]))

    def test_wind_absent_by_default_and_zero_is_equivalent(self):
        self.assertEqual(self.config(), self.config('--left-quarter-wind', '0'))
        self.assertIsNone(self.config()['quartering_wind'])
        self.assertEqual((self.config()['frames'], self.config()['frame']), (150, 120))

    def test_threads_default_to_all_cores_except_the_gathered_study(self):
        self.assertEqual(self.config()['threads'], 4)
        for name in ('silk-tilt25', 'silk-tilt35', 'silk-tilt25-cling'):
            with self.subTest(name=name):
                self.assertIsNone(self.config(preset=name)['threads'])
        self.assertEqual(self.config('--threads', '8', preset='silk-tilt25')['threads'], 8)

    def test_existing_presets_keep_their_material_and_frame_controls(self):
        for name, tilt, strength, reach in [('silk-tilt25', 25, 0, 0),
                ('silk-tilt35', 35, 0, 0), ('silk-tilt25-cling', 25, -100, 1)]:
            with self.subTest(name=name):
                c = self.config(preset=name)
                self.assertEqual((c['tilt_deg'], c['cling_strength'], c['cling_reach']), (tilt, strength, reach))
                self.assertEqual((c['frames'], c['frame']), (120, 100))
                self.assertIsNone(c['quartering_wind'])

    def test_wind_geometry_support_is_left_and_faces_inward(self):
        for strength in (250, 750):
            c = self.config('--left-quarter-wind', str(strength))
            control = c['quartering_wind']
            self.assertEqual(control['strength'], strength)
            self.assertAlmostEqual(validate_profile(control['profile'], c), .07514718055725098)
            self.assertEqual(len(control['profile']['triangles']), 10)
            self.assertEqual(len(control['profile']['vertices']), 20)

    def test_bad_cli_values_fail_before_launching_blender(self):
        cases = [('--left-quarter-wind', '-1'), ('--left-quarter-wind', 'nan'),
                 ('--left-quarter-wind', 'inf'), ('--scale', '0'), ('--head-height', '-1'),
                 ('--frame-width', 'nan'), ('--tilt', 'inf'), ('--frames', '119'),
                 ('--frame', '1'), ('--threads', '0'), ('--threads', '65'),
                 ('--cling', '-10', '--cling-reach', '0'), ('--wind-profile', 'unused.json')]
        for case in cases:
            with self.subTest(case=case), self.assertRaises(ValueError):
                self.config(*case)

    def test_wind_rejects_uncalibrated_placement_or_timing(self):
        for options in [('--tilt', '35'), ('--scale', '4'), ('--frame', '100'), ('--frames', '140'),
                        ('--cling', '0'), ('--cling-reach', '2')]:
            with self.subTest(options=options), self.assertRaises(ValueError):
                self.config('--left-quarter-wind', '250', *options)
        with self.assertRaises(ValueError):
            self.config('--left-quarter-wind', '250', preset='silk-tilt25')
        options = parse_args(['another.glb', '--preset', 'silk-gathered', '--out', 'out', '--left-quarter-wind', '250'])
        with self.assertRaisesRegex(ValueError, 'different figure'):
            build_config(options)

    def test_malformed_and_nonfinite_pose_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'pose.json'
            for invalid in ([], {}, None):
                path.write_text(json.dumps(invalid))
                with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                    self.config('--pose', str(path))
            for pose in [[], [[1, 0, 0]], [[1, 0, 0], [0, 1, 0], [0, 0, math.nan]]]:
                path.write_text(json.dumps({'rigid_pose_rotation_rows': pose}))
                with self.subTest(pose=pose), self.assertRaises(ValueError):
                    self.config('--pose', str(path))

    def test_custom_profile_is_loaded_and_validated(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'wind.json'
            profile = self.config('--left-quarter-wind', '250')['quartering_wind']['profile']
            profile['reach'] = .2
            path.write_text(json.dumps(profile))
            c = self.config('--left-quarter-wind', '750', '--wind-profile', str(path))
            self.assertEqual(c['quartering_wind']['profile']['reach'], .2)

    def test_adversarial_geometry_cannot_silently_reverse_or_expand_load(self):
        c = self.config('--left-quarter-wind', '250')
        base = c['quartering_wind']['profile']
        for change in [lambda p: p.update(reach=.4), lambda p: p.update(reach=math.nan),
                lambda p: p.update(wind_world=[1, -1, 0]),
                lambda p: p['triangles'][0].reverse(),
                lambda p: p['triangles'][0].__setitem__(0, 999),
                lambda p: p['triangles'][0].__setitem__(0, True),
                lambda p: p['vertices'][0].__setitem__(1, math.inf),
                lambda p: p['vertices'].append([1, 1, 1]),
                lambda p: p.update(vertices=[[1e200, 0, 0], [2e200, 1e200, 0], [1e200, 0, 1e200]], triangles=[[0, 1, 2]]),
                lambda p: p.update(falloff_power=-1), lambda p: p.update(unrecognized=True)]:
            profile = copy.deepcopy(base)
            change(profile)
            with self.subTest(profile=profile), self.assertRaises(ValueError):
                validate_profile(profile, c)


if __name__ == '__main__':
    unittest.main()
