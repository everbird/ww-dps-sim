"""TD-01 §15 中不需要 xlsx 的用例：单元格级解析（T01-1、T01-2、T01-11、T01-12）。

运行：pnpm test:py（即 python3 -m unittest discover -s tools/build -p 'test_*.py'）
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from parse import (Issues, extract_birth_frame, extract_hints, name_tags, parse_flag, parse_gain,  # noqa: E402
                   parse_list, parse_num, sec_to_frames)


class T01_1_数值与列表(unittest.TestCase):
    def test_parse_num(self):
        iss = Issues()
        self.assertEqual(parse_num(35985, 'x', iss), 35985)
        self.assertEqual(parse_num('0+25', 'x', iss), 25)
        self.assertIsNone(parse_num('/', 'x', iss))
        self.assertIsNone(parse_num('12F', 'x', iss))
        kinds = {k for (_, k) in iss.items}
        self.assertEqual(kinds, {'算术字符串', '斜杠占位', '数值无法解析'})
        self.assertEqual(iss.count('error'), 1)

    def test_parse_list(self):
        iss = Issues()
        self.assertEqual(parse_list('4,2', 'x', iss), [4, 2])
        self.assertEqual(parse_list(11, 'x', iss), [11])
        self.assertEqual(parse_list(5.1, 'x', iss), [5, 1])
        self.assertEqual(list(iss.items), [('warn', '小数点当逗号')])

    def test_parse_flag(self):
        iss = Issues()
        self.assertEqual([parse_flag('√', 'x', iss), parse_flag('×', 'x', iss), parse_flag(None, 'x', iss)], [True, False, None])

    def test_sec_to_frames(self):
        self.assertEqual([sec_to_frames(0.3), sec_to_frames(14.8), sec_to_frames(20), sec_to_frames(0.005)], [18, 888, 1200, 1])


class T01_2_资源单元格(unittest.TestCase):
    def g(self, cached, formula=None):
        return parse_gain(cached, formula, 'x', Issues())

    def test_forms(self):
        self.assertEqual(self.g(10), {'total': 10})
        self.assertEqual(self.g(20, '=0+20'), {'total': 20, 'perHit': [0], 'onAction': 20, 'formula': '=0+20'})
        self.assertEqual(self.g(9, '=4+5'), {'total': 9, 'perHit': [4], 'onAction': 5, 'formula': '=4+5'})
        self.assertEqual(self.g(-12, '=0+(-10-2)'), {'total': -12, 'perHit': [0], 'onAction': -12, 'formula': '=0+(-10-2)'})
        self.assertEqual(self.g(1.67, '=167*0.01'), {'total': 1.67, 'formula': '=167*0.01'})
        self.assertEqual(self.g(0.2, '=$T$102'), {'total': 0.2, 'ref': 'T102'})
        c = self.g(-100, '=-base!$ER$80/base!$ER$80*100')
        self.assertTrue(c['complex'])

    def test_arith_string(self):
        """渊武 R330 的"0+25"是字符串不是公式：按多项公式处理并告警"""
        iss = Issues()
        self.assertEqual(parse_gain('0+25', None, 'x', iss), {'total': 25, 'perHit': [0], 'onAction': 25, 'formula': '=0+25'})
        self.assertIn(('warn', '算术字符串'), iss.items)

    def test_sum_mismatch(self):
        iss = Issues()
        parse_gain(21, '=0+20', 'x', iss)
        self.assertIn(('error', '公式项之和与缓存值不符'), iss.items)

    def test_dmg_lookup(self):
        """v0.1.2：INDEX(dmg!…) 查表等同于直接写数字；外加常数项时拆成逐段 + 进入动作即得"""
        look = '=INDEX(dmg!$BK$459:$BK$495,MATCH($A$1380&$C1380,dmg!$A$459:$A$495&dmg!$B$459:$B$495,0),1)*0.01'
        self.assertEqual(self.g(2, look), {'total': 2})
        self.assertEqual(self.g(10, look + '+10'), {'total': 10, 'perHit': [0], 'onAction': 10, 'formula': look + '+10'})
        self.assertEqual(self.g(16.53, look + '+12'), {'total': 16.53, 'perHit': [4.53], 'onAction': 12, 'formula': look + '+12'})


class T01_11_出生帧(unittest.TestCase):
    def test_cases(self):
        self.assertIsNone(extract_birth_frame('=ROUNDUP(0.16666667*base!$B$2,0)', 11))
        self.assertEqual(extract_birth_frame('=ROUNDUP((0.16666667+0.067*1)*base!$B$2,0)', 15), 11)
        qy = ('=INT((0.3333333+0.6)*base!$B$2)+ROUND((0.3333333+0.6)*base!$B$2-INT((0.3333333+0.6)*base!$B$2),0)'
              '+(1-(0.3333333+0.6)>=1-0.5/base!$B$2)')
        self.assertEqual(extract_birth_frame(qy, 56), 20)
        self.assertIsNone(extract_birth_frame('=ROUNDUP((0.53333336+0.014875)*base!$B$2,0)', 33))
        self.assertIsNone(extract_birth_frame(None, 10))


class T01_12_备注并列写法(unittest.TestCase):
    def test_cases(self):
        self.assertEqual(extract_hints('第68F前不响应输入、不能切人\n第57F触发上一角色延奏\n第1F获得100点战势、20点权柄'),
                         {'noInputBefore': 68, 'noSwitchBefore': 68, 'outroTriggerFrame': 57})
        # 区间写法取起点并标出（TD-05 §4.1，原 T01-12 不产出）
        self.assertEqual(extract_hints('第71F前不能切人、不响应输入\n第30F获得3点晶质\n第59～65F触发上一角色延奏，伤害命中后触发被动2'),
                         {'noSwitchBefore': 71, 'noInputBefore': 71, 'outroTriggerFrame': 59, 'outroRange': True})
        self.assertEqual(extract_hints('地面E，第21F前不能闪避、跳跃\n第12F重新索敌，摇杆方向，最大距离10m'), {'noDodgeBefore': 21})

    def test_several_locks_in_one_sentence(self):
        """逗号分开的几条限制各自匹配（千咲 QTE）"""
        self.assertEqual(extract_hints('第48F前不响应输入，第54F前不能切人，第100F前可派生A2 | 第34F触发上一角色延奏'),
                         {'noInputBefore': 48, 'noSwitchBefore': 54, 'outroTriggerFrame': 34})

    def test_switch_ends_action(self):
        """TD-05 §5：切人会结束的动作"""
        self.assertEqual(extract_hints('第72F后切人立即结束技能'), {'endOnSwitchAfter': 72})
        self.assertEqual(extract_hints('第24F后切人结束技能；持续帧内每6F进行一次判定，最多19次'),
                         {'endOnSwitchAfter': 24, 'tickInterval': 6, 'maxTicks': 19})
        self.assertEqual(extract_hints('第80F后切人消失'), {'endOnSwitchAfter': 80})
        self.assertEqual(extract_hints('切人立即消失'), {'endOnSwitchAfter': 0})
        self.assertEqual(extract_hints('切人后中断动作并触发离场'), {'endOnSwitchAfter': 0})
        self.assertEqual(extract_hints('第30F前切人不离场'), {})
        self.assertEqual(extract_hints('立即触发上一角色延奏 不处于轮滑状态时…'), {'outroTriggerFrame': 0})

    def test_other_hints(self):
        self.assertEqual(extract_hints('持续帧内每6F进行一次判定，最多4次'), {'tickInterval': 6, 'maxTicks': 4})
        self.assertEqual(extract_hints('冰棱判定存在342F'), {'existsFrames': 342})


class 行名标记(unittest.TestCase):
    def test_tags(self):
        self.assertEqual(name_tags('C5大招-2'), {'chain': 5})
        self.assertEqual(name_tags('A3-1D'), {'dodgeCounter': True})
        self.assertEqual(name_tags('大招-隐藏HUD'), {})
        self.assertEqual(name_tags('闪避-前'), {'dir': '前'})


if __name__ == '__main__':
    unittest.main()
