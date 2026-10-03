"""TD-01 §7、§9 的用例（不需要 xlsx）：武器（T01-8）、敌人。

运行：pnpm test:py
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from enemies import build_enemies  # noqa: E402
from parse import Issues  # noqa: E402
from weapons import parse_weapon  # noqa: E402


def weapon_row(**cells):
    """按列字母给出单元格，其余为空（A 列起）"""
    from openpyxl.utils import column_index_from_string as ci
    row = [None] * 62
    for k, v in cells.items():
        row[ci(k) - 1] = v
    return row


class T01_8_武器(unittest.TestCase):
    def test_苍鳞千嶂(self):
        row = weapon_row(
            A='[5]苍鳞千嶂（忌炎）', B=21010016, C=5, D=1, F=7, G=47, H=0, I=9, J=1080, K=0,
            L='全属性伤害加成提升', M='%', N=1, O=220027, P=0, Q=1200, R=1500, S=1800, T=2100, U=2400,
            V='变奏或施放大招后，获得一层持续时间为14s的', W='%重击伤害加成提升buff，重复获得刷新持续时间，最多持有2层buff。',
            X=2, Y=18, Z=0, AA=2400, AB=3000, AC=3600, AD=4200, AE=4800)
        w = parse_weapon(row, 11, 125000, 45000, Issues())
        self.assertEqual({k: w[k] for k in ('key', 'rarity', 'owner', 'type', 'main', 'sub')},
                         {'key': '苍鳞千嶂', 'rarity': 5, 'owner': '忌炎', 'type': '长刃',
                          'main': {'propId': 7, 'value90': 587}, 'sub': {'propId': 9, 'value90': 0.486}})
        self.assertEqual(w['effects'], [
            {'text': '全属性伤害加成提升{v}%', 'stackLimit': 1, 'propId': 220027, 'policy': 0,
             'values': [0.12, 0.15, 0.18, 0.21, 0.24]},
            {'text': '变奏或施放大招后，获得一层持续时间为14s的{v}%重击伤害加成提升buff，重复获得刷新持续时间，最多持有2层buff。',
             'stackLimit': 2, 'propId': 18, 'policy': 0, 'values': [0.24, 0.3, 0.36, 0.42, 0.48]}])

    def test_比例型副属性与无数值的效果(self):
        """IsRatio = 1 时 Value 已是小数；效果右半为空时文本就是左半，数值全空记 null"""
        row = weapon_row(A='[4]行进序曲', B=21020024, C=4, D=2, F=7, G=27, H=0, I=11, J=0.1152, K=1,
                         L='施放共鸣技能时，回复8点协奏能量，每20秒可触发1次。', N=1)
        w = parse_weapon(row, 45, 125000, 45000, Issues())
        self.assertEqual((w['owner'], w['type'], w['main']['value90'], w['sub']['value90']), (None, '迅刀', 337, 0.5184))
        self.assertEqual(w['effects'], [{'text': '施放共鸣技能时，回复8点协奏能量，每20秒可触发1次。', 'stackLimit': 1,
                                         'propId': None, 'policy': None, 'values': None}])

    def test_分隔行跳过(self):
        for name in ('—— 长刃 ——', 'TEST', '无武器'):
            self.assertIsNone(parse_weapon(weapon_row(A=name, D=1), 4, 125000, 45000, Issues()))


class T01_9b_敌人(unittest.TestCase):
    def test_名称后缀与重名(self):
        head = [4, 90, 100000, 800, 1512, 0.1, 0.1, 0.1, 0.4, 0.1, 0.1, 0.1, 18097, 0, 0, 150, 5, 0, 3920, 1.5, 8.87]
        rows = [['朔雷之鳞', '全息6', *head], ['朔雷之鳞', '全息6', *head], ['云海妖精 *21', '海墟', *head]]
        es = build_enemies(rows, Issues())
        self.assertEqual([e['id'] for e in es], ['全息6/朔雷之鳞', '全息6/朔雷之鳞#2', '海墟/云海妖精'])
        self.assertEqual((es[2]['name'], es[2]['count']), ('云海妖精', 21))
        e = es[0]
        self.assertEqual((e['cost'], e['level'], e['def']), (4, 90, 1512))
        self.assertEqual(e['res'], {'物理': 0.1, '冷凝': 0.1, '热熔': 0.1, '导电': 0.4, '气动': 0.1, '衍射': 0.1, '湮灭': 0.1})
        self.assertEqual((e['whiteBar'], e['poise'], e['tunabilityMax']),
                         ({'max': 18097, 'recover': 0, 'reduce': 0}, {'max': 150, 'recover': 5, 'reduce': 0}, 3920))


if __name__ == '__main__':
    unittest.main()


class 伤害表取哪一级(unittest.TestCase):
    """TD-01 §4.3：角色技能取 10 级；只有第 1 级有倍率的（延奏等不随技能等级成长）取 1 级"""

    def test_level(self):
        from dmg import level_index
        grow = [10000 + i * 500 for i in range(20)]
        self.assertEqual(level_index('1603', 'A1', grow), 10)
        self.assertEqual(level_index('1603', '延奏-C0普通', [32924] + [0] * 19), 1)
        self.assertEqual(level_index('通用', '谐度破坏-迅刀1', grow), 1)
        self.assertEqual(level_index('1603', '空', [0] * 20), 10)
