"""TD-01 §11.3 / TD-03 §6：谐度破坏表 → tune-break.json（不需要 xlsx）。

运行：pnpm test:py
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from openpyxl.utils import column_index_from_string as ci  # noqa: E402
from parse import Issues  # noqa: E402
from tune_break import build_tune_break, parse_tune_rules  # noqa: E402

# 「附页2」B227 的原文（20260707 版，节选）
RULES_TEXT = ('偏谐机制·通用\n谐破冷却：\n·处于失谐状态时，被角色的谐度破坏命中后获得，COST1/3/4/红名目标分别冷却6/6/3/3秒；\n'
              '·冷却期间无法累积偏谐值。\n\n谐度破坏：\n当前角色处于失谐/对策技期间目标的圆柱范围(2000,0,500)内时，'
              '造成偏谐值不为0的伤害后，可触发谐度破坏技交互，交互按键持续3秒。')


def dmg_entry(rate: int, row: int) -> dict:
    cells = [None] * 110
    cells[33] = rate                                                  # RateLv_1（AH）
    return {'row': row, 'cells': cells}


def base_row(**cells):
    r = [None] * 45
    for k, v in cells.items():
        r[ci(k) - 1] = v
    return r


class 谐度破坏表(unittest.TestCase):
    def test_变体_结算次数_基础值_COST系数(self):
        dmg = {
            ('通用', '谐度破坏'): dmg_entry(160000, 1),               # 不带武器的总行：不算变体
            ('通用', '谐度破坏-迅刀1'): dmg_entry(10000, 2),
            ('通用', '谐度破坏-迅刀2'): dmg_entry(120000, 3),
            ('通用', '谐度破坏-音感仪'): dmg_entry(160000, 4),
            ('1102', '谐度破坏-1'): dmg_entry(10000, 5),              # 角色块的行：不算
        }
        table = [
            [None, '谐度破坏', None, '倍率', '对失谐伤害', '对常态伤害', '结算次数'],
            [None, '对COST4通用', None, 16, 62668, 7, 1],
            [None, '迅刀-1', None, 1, 3917, 1, 4],
            [None, '迅刀-2', None, 12, 47001, 5, 1],
            [None, '音感仪', None, 16, 62668, 7, 1],
        ]
        base = [base_row(R=1, T=0.000184818481848185, U=1.00260700871199, AM=1, AO=15150),
                base_row(R=3, T=0.000554455445544555, U=1.00264401759432, AM=2, AO=20000),
                base_row(R=4, T=0.00258745874782178, U=1.00264699923041, AM=3, AO=30000)]
        base += [base_row(AM=lv, AO=1000 * lv) for lv in range(4, 101)]
        issues = Issues()
        t = build_tune_break(dmg, table, base, issues, [('A1', '偏谐机制·通用'), ('B227', RULES_TEXT)])
        self.assertEqual([(v['key'], v['weaponType'], v['seq'], v['multiplier'], v['ticks']) for v in t['variants']], [
            ('谐度破坏-迅刀1', '迅刀', 1, 1, 4), ('谐度破坏-迅刀2', '迅刀', 2, 12, 1), ('谐度破坏-音感仪', '音感仪', None, 16, 1)])
        self.assertEqual(t['variants'][0]['golden'], {'vsDisharmony': 3917, 'vsNormal': 1})
        self.assertEqual(t['costRows'], [{'label': '对COST4通用', 'multiplier': 16, 'vsDisharmony': 62668, 'vsNormal': 7, 'ticks': 1}])
        self.assertEqual(t['baseByLevel'][:3], [15150, 20000, 30000])
        self.assertEqual(t['baseByLevel'][89], 90000)
        self.assertAlmostEqual([f['factor'] for f in t['costFactors'] if f['cost'] == 4][0], 0.0025943077491359817)
        self.assertEqual(t['rules'], {'lockSec': {'1': 6, '3': 6, '4': 3}, 'lockSecRedName': 3, 'buttonSec': 3, 'source': '附页2 B227'})
        self.assertEqual(issues.count('warn'), 3)                       # 缺长刃、佩枪、臂铠

    def test_规则_认不出或找不到就警告并记null(self):
        issues = Issues()
        self.assertIsNone(parse_tune_rules([('B227', RULES_TEXT.replace('分别冷却', '冷却'))], issues))
        self.assertIsNone(parse_tune_rules([('B1', '聚怪牵引')], issues))
        self.assertEqual(issues.count('warn'), 2)


if __name__ == '__main__':
    unittest.main()
