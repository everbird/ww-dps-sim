"""动作表的列按表头名找（TD-01 §3.1）：20261003 / 20261019 两种表头布局、「延迟」「多判间隔/次」两列、块改名（不需要 xlsx）。

运行：pnpm test:py
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from actions import ActionCols, block_key, multi_hit_hints, parse_action_sheet  # noqa: E402
from parse import Issues  # noqa: E402

DIL = ['时间膨胀类型', '自膨胀系数', '膨胀发生', '膨胀持续', '敌膨胀系数', '膨胀发生', '膨胀持续', '友膨胀系数', '膨胀发生', '膨胀持续']
TAIL = ['可弹刀', '可脱手', '跟随顿帧', '削韧值', '偏谐值', '大招回收', '协奏回收', '核心回收1', '核心回收2', '核心回收3',
        '受击韧性系数', '中断优先级', '位置状态', '状态转换时间', *DIL, '命中类型', '位置基准']
# 20261003 版（A–AT）与 20261019 版（G 插"延迟"、J 插"多判间隔/次"）
H1003 = ['名称', 'ID', '动作', '备注', '发生帧', '持续帧', '顿帧-自', '顿帧-敌', '无敌启动帧', '无敌持续帧', '优先级改变',
         '派生帧', '派生持续帧', '动作结束帧', *TAIL]
H1019 = ['名称', 'ID', '动作', '备注', '发生帧', '持续帧', '延迟', '顿帧-自', '顿帧-敌', '多判间隔/次', '无敌启动帧', '无敌持续帧',
         '优先级改变', '派生帧', '派生持续帧', '动作结束帧', *TAIL]


def row(head: list, **cells) -> list:
    r = [None] * len(head)
    for k, v in cells.items():
        r[head.index(k)] = v
    return r


class 表头布局(unittest.TestCase):
    def test_旧版列位不变(self):
        c = ActionCols(H1003)
        self.assertEqual((c.spawn, c.life, c.hs_self, c.hs_enemy, c.prio_change, c.end, c.follow), (4, 5, 6, 7, 10, 13, 16))
        self.assertEqual((c.tough, c.tune, c.gains[0][1], c.priority, c.dil_type, c.hit_target), (17, 18, 19, 25, 28, 38))
        self.assertEqual(c.dil_sides, [('self', 29), ('enemy', 32), ('ally', 35)])
        self.assertIsNone(c.delay)
        self.assertIsNone(c.multi_hit)

    def test_新版插了两列(self):
        c = ActionCols(H1019)
        self.assertEqual((c.delay, c.hs_self, c.multi_hit, c.end, c.tough, c.hit_target), (6, 7, 9, 15, 19, 40))
        self.assertEqual(c.dil_sides, [('self', 31), ('enemy', 34), ('ally', 37)])

    def test_缺表头报错(self):
        with self.assertRaises(ValueError):
            ActionCols([h for h in H1019 if h != '削韧值'])

    def test_两种布局读出同样的行(self):
        cells = dict(名称='椿', ID=1, 动作='A1', 发生帧=12, 持续帧=3, **{'顿帧-自': 1, '动作结束帧': 34, '削韧值': 37, '中断优先级': '2', '命中类型': '目标'})
        out = []
        for head in (H1003, H1019):
            iss = Issues()
            blk = parse_action_sheet('角色-女', '女', [head, row(head, **cells)], [head, [None] * len(head)], {}, iss)
            out.append(blk[0]['groups'][0]['rows'][0])
        self.assertEqual(out[0], out[1])
        self.assertEqual((out[0]['spawnFrame'], out[0]['endFrame'], out[0]['toughness'], out[0]['priority']), (12, 34, 37, [2]))
        self.assertIsNone(out[0]['delayFrames'])


class 新列(unittest.TestCase):
    def test_延迟与多判(self):
        iss = Issues()
        head = H1019
        r = row(head, 名称='照世心', ID=1, 动作='A1-1', 发生帧=1, 持续帧=11, 延迟=4, **{'多判间隔/次': '6F / 2次', '命中类型': '目标'})
        blk = parse_action_sheet('角色-女', '女', [head, r], [head, [None] * len(head)], {}, iss)
        x = blk[0]['groups'][0]['rows'][0]
        self.assertEqual(x['delayFrames'], 4)
        self.assertEqual(x['hints'], {'tickInterval': 6, 'maxTicks': 2})

    def test_延迟写在备注里(self):
        # 老角色把延迟写在备注"脱手后延迟nF生效"：列空时按备注；列与备注都有、对不上时以列为准并报告
        out = []
        for head, extra in ((H1003, {}), (H1019, {'延迟': 7}), (H1019, {'延迟': 6})):
            iss = Issues()
            r = row(head, 名称='卜灵', ID=1, 动作='QTE-伤害', 备注='脱手后延迟7F生效', 发生帧=7, 持续帧=6, **extra, **{'命中类型': '目标'})
            blk = parse_action_sheet('角色-女', '女', [head, r], [head, [None] * len(head)], {}, iss)
            out.append((blk[0]['groups'][0]['rows'][0]['delayFrames'], [k for (_, k) in iss.items]))
        self.assertEqual(out, [(7, []), (7, []), (6, ['延迟与备注不同'])])

    def test_无敌两列与无敌期间不能切人(self):
        # 雷主·男 大招-前置（20261019 版 角色-男 R1016）：备注"无敌期间不能切人"、无敌 1 / 224；心 转相的无敌持续帧是空格
        out = []
        for dur in (224, ' ', None):
            iss = Issues()
            r = row(H1019, 名称='雷主', ID=1, 动作='大招-前置', 备注='无敌期间不能切人\n结束帧前禁用E技能', 无敌启动帧=1, 无敌持续帧=dur)
            hit = row(H1019, 动作='大招-伤害', 发生帧=190, 持续帧=60, **{'动作结束帧': 224, '命中类型': '目标'})
            blk = parse_action_sheet('角色-男', '男', [H1019, r, hit], [H1019, [None] * len(H1019), [None] * len(H1019)], {}, iss)
            x = blk[0]['groups'][0]['rows'][0]
            out.append((x['invincible'], x['hints']))
        self.assertEqual(out, [({'start': 1, 'duration': 224}, {'noSwitchWhileInvincible': True}),
                               ({'start': 1, 'duration': None}, {'noSwitchWhileInvincible': True}),
                               ({'start': 1, 'duration': None}, {'noSwitchWhileInvincible': True})])

    def test_没有无敌两列(self):
        head = [h for h in H1019 if h not in ('无敌启动帧', '无敌持续帧')]
        r = row(head, 名称='椿', ID=1, 动作='A1', 发生帧=12, 持续帧=3, **{'命中类型': '目标'})
        blk = parse_action_sheet('角色-女', '女', [head, r], [head, [None] * len(head)], {}, Issues())
        self.assertIsNone(blk[0]['groups'][0]['rows'][0]['invincible'])

    def test_多判与备注(self):
        iss = Issues()
        self.assertEqual(multi_hit_hints('8F / 4次', {}, 'x', iss), {'tickInterval': 8, 'maxTicks': 4})
        self.assertEqual(multi_hit_hints(None, {}, 'x', iss), {})
        self.assertEqual(len(iss.items), 0)
        multi_hit_hints('8F / 4次', {'tickInterval': 6}, 'x', iss)              # 与备注对不上：以列为准并报告
        multi_hit_hints('每8F', {}, 'x', iss)
        self.assertEqual([k for (_, k) in iss.items], ['多判间隔/次与备注不同', '多判间隔/次无法解析'])


class 块改名(unittest.TestCase):
    def test_心(self):
        self.assertEqual(block_key('应世心', '女'), '心')                         # 常态用角色名；照世心不改，由角色模块并入
        self.assertEqual(block_key('照世心', '女'), '照世心')
        self.assertEqual(block_key('雷主', '男'), '雷主·男')


if __name__ == '__main__':
    unittest.main()
