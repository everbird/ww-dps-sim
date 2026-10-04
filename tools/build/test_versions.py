"""xlsx 版本清单（data/xlsx-versions.json）：构建缺省用哪份、核对 sha256（不需要 xlsx）。

运行：pnpm test:py
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from versions import pick_xlsx, sha256_of  # noqa: E402


class 版本清单(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.raw = Path(self.tmp.name) / 'raw'
        (self.raw / 'archive').mkdir(parents=True)
        self.old = self.raw / 'archive' / '汇总-20260707.xlsx'
        self.new = self.raw / '汇总-20261003.xlsx'
        self.old.write_bytes(b'old')
        self.new.write_bytes(b'new')
        self.manifest = Path(self.tmp.name) / 'xlsx-versions.json'

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, current, old_sha=None):
        self.manifest.write_text(json.dumps({'current': current, 'versions': [
            {'version': '20260707', 'file': self.old.name, 'sha256': old_sha or sha256_of(self.old)},
            {'version': '20261003', 'file': self.new.name, 'sha256': sha256_of(self.new)},
        ]}), 'utf-8')

    def test_缺省取current_子目录也找得到(self):
        self.write('20260707')
        path, entry, problems = pick_xlsx(None, self.raw, self.manifest)
        self.assertEqual((path, entry['version'], problems), (self.old, '20260707', []))
        self.write('20261003')
        self.assertEqual(pick_xlsx(None, self.raw, self.manifest)[0], self.new)

    def test_哈希不同或找不到文件就报错(self):
        self.write('20260707', old_sha='0' * 64)
        path, _, problems = pick_xlsx(None, self.raw, self.manifest)
        self.assertIsNone(path)
        self.assertEqual(problems[0][0], 'error')
        self.assertIn('sha256', problems[0][1])
        self.write('20260707')
        self.old.unlink()
        path, _, problems = pick_xlsx(None, self.raw, self.manifest)
        self.assertIsNone(path)
        self.assertIn('找不到', problems[0][1])

    def test_直接传路径_不在清单里只警告(self):
        self.write('20260707')
        other = self.raw / '别的.xlsx'
        other.write_bytes(b'x')
        path, entry, problems = pick_xlsx(str(other), self.raw, self.manifest)
        self.assertEqual((path, entry), (other, None))
        self.assertEqual([p[0] for p in problems], ['warn'])
        self.assertEqual(pick_xlsx(str(self.new), self.raw, self.manifest)[1]['version'], '20261003')   # 在清单里：照样核对


if __name__ == '__main__':
    unittest.main()
