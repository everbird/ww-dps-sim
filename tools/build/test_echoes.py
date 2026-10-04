"""TD-01 §8 声骸表的用例（不需要 xlsx）：COST、分组（技能版本 / 多段 / 体型）、倍率连接（dmg → nanoka）。

运行：pnpm test:py
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from echoes import build_costs, cost_of, drop_phantoms, group_id, join_echo, parse_echo_sheet, text_kind  # noqa: E402
from parse import Issues  # noqa: E402


def row(**cells):
    """按列字母给出单元格，其余为空（A 列起，34 列）"""
    from openpyxl.utils import column_index_from_string as ci
    r = [None] * 34
    for k, v in cells.items():
        r[ci(k) - 1] = v
    return r


HEAD = row(A='名称', B='动作')


def sheet(*rows, merges=()):
    """rows 从第 2 行起；merges：(列字母, 首行, 末行)"""
    from openpyxl.utils import column_index_from_string as ci
    values = [HEAD, *rows]
    mp = {}
    for col, a, b in merges:
        for i in range(a, b + 1):
            mp[(i, ci(col))] = (a, b)
    return values, mp


def parse(values, mp, costs=None):
    return parse_echo_sheet(values, [], mp, costs or {}, Issues())


class COST(unittest.TestCase):
    def test_索引页(self):
        rows = [[None, '声 骸'], [None, 'COST4', '鸣钟之龟', '无冠者'], [None, None, None, '梦魇'], [None, None, '利维亚坦'],
                [], [None, 'COST3', '踏光兽'], [None, 'COST1', '叮咚咚']]
        costs = build_costs(rows)
        self.assertEqual(costs, {'鸣钟之龟': 4, '无冠者': 4, '利维亚坦': 4, '踏光兽': 3, '叮咚咚': 1})
        self.assertEqual([cost_of(n, costs) for n in ('梦魇·无冠者', '异相·无冠者', '暗鬃狼')], [4, 4, None])


class 分组(unittest.TestCase):
    def test_体型分行(self):
        """鸣钟之龟：每种体型一行、各自一个「类型」格 → 每行一组，组名去掉体型前缀"""
        values, mp = sheet(
            row(A='鸣钟之龟', B='成女-召唤', C=22, D=12, I=33, L=152, M=4.55, N=0, P=5, Q='召唤', R=20,
                X='……造成基于自身防御力145.92%的冷凝伤害……\n技能冷却：20秒'),
            row(B='少女-召唤', C=22, D=12, I=33, L=152, M=4.55, N=0, P=5, Q='召唤', R=20),
            merges=[('A', 2, 3)])
        [e] = parse(values, mp, {'鸣钟之龟': 4})
        self.assertEqual([(g['id'], g['body'], g['variant'], g['kind'], g['cooldown']) for g in e['groups']],
                         [('召唤', '成女', 1, '召唤', 1200), ('召唤', '少女', 2, '召唤', 1200)])
        self.assertEqual((e['cost'], e['descCooldown'], e['flags']), (4, 1200, []))
        r = e['groups'][0]['rows'][0]
        self.assertEqual((r['kind'], r['spawnFrame'], r['endFrame'], r['priority'], r['toughness'], r['gains']['energy']),
                         ('hit', 22, 33, [5], 152, {'total': 4.55}))

    def test_技能版本(self):
        """无常凶鹭：「类型」两格 → 点按 / 长按两组；「冷却」合并区两组共用"""
        values, mp = sheet(
            row(A='无常凶鹭', B='砸地', C=77, D=6, I=92, L=194.1, M=4.85, Q='变身', R=20),
            row(B='喷火', C=50, D=162, I=205, L=34.83, M=0.87, Q='变身'),
            merges=[('A', 2, 3), ('R', 2, 3)])
        [e] = parse(values, mp)
        self.assertEqual([(g['id'], g['variant'], g['stage'], g['cooldown']) for g in e['groups']],
                         [('砸地', 1, None, 1200), ('喷火', 2, None, 1200)])
        self.assertIn('costMissing', e['flags'])

    def test_多段(self):
        """无冠者：有单段冷却 / 接续时限 → 按行名前缀分段；冷却只记在第一段；本段的窗口给下一段"""
        values, mp = sheet(
            row(A='无冠者', B='A1', C=11, D=9, I=73, Q='变身', R=20, S=0.5, T=1.25,
                X='……可连续使用最多4次……\n技能冷却：20秒'),
            row(B='A2', C=20, D=9, I=90, S=0.5, T=1.5),
            row(B='A3-1', C=8, D=9, S=0.45, T=1),
            row(B='A3-2', C=21, D=6, I=64),
            row(B='A4-1', C=42, D=9),
            row(B='A4-2', C=48, D=9, I=76),
            merges=[('A', 2, 7), ('Q', 2, 7), ('R', 2, 7)])
        [e] = parse(values, mp)
        self.assertEqual([(g['id'], g['stage'], g['cooldown'], g['next'], [r['name'] for r in g['rows']]) for g in e['groups']], [
            ('A1', 1, 1200, {'from': 30, 'until': 75}, ['A1']),
            ('A2', 2, None, {'from': 30, 'until': 90}, ['A2']),
            ('A3', 3, None, {'from': 27, 'until': 60}, ['A3-1', 'A3-2']),
            ('A4', 4, None, None, ['A4-1', 'A4-2']),
        ])
        self.assertIn('stagesGuess', e['flags'])

    def test_组名取公共前缀(self):
        self.assertEqual([group_id(n) for n in (['斩击1', '斩击2', '斩击6'], ['转圈-1', '转圈-4'], ['爆气', '拳击循环-1', '终结拳'],
                                                 ['连续拳-1', '终结拳'], ['砸地'], ['标枪-弹道'])],
                         ['斩击', '转圈', '爆气', '连续拳', '砸地', '标枪-弹道'])

    def test_异相取本体(self):
        """异相只换配色：本体在表里的不单独产出；表里数值与本体不同的标出来（只提示）"""
        values, mp = sheet(
            row(A='无常凶鹭', B='砸地', C=77, D=6, I=92, L=194.1, M=4.85, Q='变身', R=20, X='造成310.56%的湮灭伤害'),
            row(),
            row(A='异相·无常凶鹭', B='砸地', C=77, D=6, I=92, L=150.6, M=3.76, Q='变身', R=20, X='造成240.96%的湮灭伤害'),
            row(),
            row(A='异相·无冠者', B='A1', C=11, D=9, I=73, Q='变身', R=20))
        kept, dropped = drop_phantoms(parse(values, mp))
        self.assertEqual([e['key'] for e in kept], ['无常凶鹭', '异相·无冠者'])      # 本体不在表里的照常产出
        self.assertEqual(dropped, [('异相·无常凶鹭', True)])

    def test_召唤与幻形(self):
        """说明里先出现的"召唤"（脱手）/"幻形"（不脱手）；与第一个版本的「类型」列不同时打 kindText"""
        self.assertEqual([text_kind(d) for d in ('使用声骸技能，召唤蚀脊龙', '幻形为梦魇·凯尔匹……离场时可召唤梦魇·凯尔匹', '发动鸣钟之龟的加护', None)],
                         ['召唤', '变身', None, None])
        values, mp = sheet(row(A='角鳄', B='跳砸', C=90, D=6, I=161, L=149, M=3.72, Q='变身', R=20, X='使用声骸技能，召唤蚀脊龙'))
        [e] = parse(values, mp)
        self.assertEqual((e['textKind'], 'kindText' in e['flags']), ('召唤', True))

    def test_说明里的冷却与充能(self):
        values, mp = sheet(
            row(A='梦魇·无冠者', B='斩击', C=11, D=9, I=39, L=175, M=4.37, Q='变身', R=20,
                X='……初始拥有3次可使用次数，每12秒可使用次数增加1次……\n技能冷却：12秒'))
        [e] = parse(values, mp)
        self.assertEqual((e['groups'][0]['cooldown'], e['descCooldown']), (1200, 720))
        self.assertEqual(set(e['flags']) - {'costMissing'}, {'cooldownText', 'charges'})

    def test_无名行与事件生成(self):
        """动作名为空的行不读（计入 ignoredRows）；声骸表没有命中类型列：有持续帧、发生帧为空的是事件生成的判定"""
        values, mp = sheet(
            row(A='梦魇·云闪之鳞', B='扔标枪-弹道', C=54, D=150, I=83, L=133.34, M=0, Q='变身', R=20),
            row(B='标枪爆炸', D=6, L=267, M=6.67),
            row(L=32, M=0.8))
        [e] = parse(values, mp)
        self.assertEqual(e['ignoredRows'], 1)
        rows = e['groups'][0]['rows']
        self.assertEqual(e['groups'][0]['id'], '扔标枪')
        self.assertEqual([(r['name'], r['kind'], r['eventSpawned']) for r in rows],
                         [('扔标枪-弹道', 'hit', False), ('标枪爆炸', 'hit', True)])


def dmg_entry(rates, **over):
    """dmg 表的一行（只填连接要用的列）"""
    cells = [None] * 110
    cells[0], cells[1] = over.get('chara', 'X'), over.get('name', 'x')
    cells[7], cells[8], cells[9], cells[32] = 0, over.get('element', 6), 5, 7
    for k, v in enumerate(rates):
        cells[33 + k] = v
    return {'row': 1, 'cells': cells, 'noConfig': False}


def nk_entry(id_, rate5, tough, energy, element=6, rel='攻击'):
    return {'id': id_, 'element': element, 'relatedProperty': rel, 'type': 5, 'rateLv': [rate5 // 2, 0, 0, 0, rate5],
            'energy': energy, 'toughLv': tough, 'weaknessLvl': 0, 'hardnessLv': 10000}


class 倍率连接(unittest.TestCase):
    def setUp(self):
        values, mp = sheet(
            row(A='甲', B='一', C=10, D=6, I=30, L=194.1, M=4.85, Q='变身', R=20),
            row(B='二', C=12, D=6, L=34.83, M=0.87),
            row(B='三', C=14, D=6, L=50, M=1),
            row(B='风场', C=13, D=90),
            row(B='四', C=16, D=6, L=175, M=4.37))
        [self.e] = parse(values, mp)
        self.rows = {r['name']: r for r in self.e['groups'][0]['rows']}

    def join(self, dmg, alias=None, nk=None):
        gaps = []
        join_echo(self.e, dmg, {'甲': alias or {}}, nk, Issues(), gaps)
        return gaps

    def test_dmg_取5级_倍率全0的不算(self):
        dmg = {('甲', '一'): dmg_entry([15200, 18240, 21280, 24320, 27360, 0]), ('甲', '二'): dmg_entry([0] * 6)}
        nk = {'damage': [nk_entry('2', 5572, 3483, 87)]}
        self.join(dmg, nk=nk)
        self.assertEqual((self.rows['一']['dmg']['via'], self.rows['一']['dmg']['multiplier']), ('direct', 2.736))
        self.assertEqual((self.rows['二']['dmg']['via'], self.rows['二']['dmg']['multiplier']), ('nanoka', 0.5572))

    def test_nanoka_按削韧与能量连_倍率要唯一(self):
        nk = {'damage': [nk_entry('1', 31056, 19410, 485), nk_entry('3a', 10000, 5000, 100), nk_entry('3b', 12000, 5000, 100),
                         nk_entry('4', 26460, 14700, 367, element=3, rel='防御')]}
        gaps = self.join({}, alias={'四': 'nanoka::4', '风场': None}, nk=nk)
        d = self.rows['一']['dmg']
        self.assertEqual((d['via'], d['multiplier'], d['skillId'], d['relatedProperty'], d['damageType'], len(d['rates'])),
                         ('nanoka', 3.1056, 1, 7, 5, 20))
        self.assertEqual((self.rows['四']['dmg']['multiplier'], self.rows['四']['dmg']['element'], self.rows['四']['dmg']['relatedProperty']),
                         (2.646, 3, 10))
        self.assertNotIn('dmg', self.rows['三'])                          # 两个候选倍率不同：不连
        self.assertNotIn('noDmg', self.rows['风场']['flags'])             # dmg-join 写了 null：明确无伤害
        self.assertEqual([(g['name'], len(g['suggest'])) for g in gaps], [('二', 4), ('三', 2)])
        self.assertIn('noDmg', self.rows['三']['flags'])


if __name__ == '__main__':
    unittest.main()
