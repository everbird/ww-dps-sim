"""TD-01 §5.4 的声骸属性 → echo-stats.json（不需要 xlsx）。

运行：pnpm test:py
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from echo_stats import SUB_COLS, build_echo_stats, stat_of_desc  # noqa: E402
from parse import Issues  # noqa: E402


def row(**cells):
    """按列字母给出单元格，其余为空（A 列起，90 列）"""
    from openpyxl.utils import column_index_from_string as ci
    r = [None] * 90
    for k, v in cells.items():
        r[ci(k) - 1] = v
    return r


class 声骸属性(unittest.TestCase):
    def test_说明文字(self):
        self.assertEqual([stat_of_desc(d) for d in ('暴击22%', '暴伤44%', '防御41.8%', '冷凝30%', '治疗26.4%', '共鸣效率32%',
                                                    '攻击150', '生命2280', '空', '—— C4 ——')],
                         [('暴击率', 0.22), ('暴击伤害', 0.44), ('防御%', 0.418), ('冷凝伤害加成', 0.3), ('治疗效果加成', 0.264),
                          ('共鸣效率', 0.32), ('攻击', 150), ('生命', 2280), None, None])

    def test_主词条_固定副主属性_副词条各档(self):
        head = row(**{c: f'PhantomModel.SubAttribute.Rand{c}' for c in SUB_COLS})
        rows = [head,
                row(BB='暴击22%', BC=4, BG='攻击150', BH=4, BR=30, CF=0.063, CD=0.064),
                row(BB='冷凝30%', BC=3, BG='攻击100', BH=3, BR=40, CF=0.069, CD=0.071),
                row(BB='空', BC=0, BG='空', BH=0, CF=0.075)]
        es = build_echo_stats(rows, Issues())
        self.assertEqual(es['mains'], [{'cost': 4, 'stat': '暴击率', 'value': 0.22}, {'cost': 3, 'stat': '冷凝伤害加成', 'value': 0.3}])
        self.assertEqual(es['fixedSubs'], [{'cost': 4, 'stat': '攻击', 'value': 150}, {'cost': 3, 'stat': '攻击', 'value': 100}])
        self.assertEqual((es['subTiers']['攻击'], es['subTiers']['暴击率']), ([30, 40], [0.063, 0.069, 0.075]))
        self.assertEqual(es['subTiers']['共鸣技能伤害加成'], es['subTiers']['普攻伤害加成'])     # 四种技能伤害加成共用一张表


if __name__ == '__main__':
    unittest.main()
