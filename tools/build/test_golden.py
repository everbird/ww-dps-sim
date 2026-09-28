"""golden 抽取的用例（不需要 xlsx）：公式解析与求值、标准答案条目（TD-01 T01-9）、乘区拆分（TD-03 §10.2）。

运行：pnpm test:py
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import golden  # noqa: E402
from xlformula import Evaluator, XlError, num_text, parse, strip_paren  # noqa: E402

CALC, CFG = golden.CALC, golden.CFG

# 散华 普攻第一段（伤害计算 D5 / E5）的原公式
D5 = ('=CEILING(((INDEX(dmg!$AH$515:$BA$535,MATCH($A$4&$B5,dmg!$A$515:$A$535&dmg!$C$515:$C$535,0),'
      'MATCH(伤害配置!$F$3,dmg!$AH$2:$BA$2,0),1)*0.0001)*$C$3+0+0)*1*MIN(2,1/(FLOOR($U$3,1)/(1+伤害配置!$B$2456)'
      '*(1-伤害配置!$B$1818)*(1+伤害配置!$B$2456-伤害配置!$N$1818)/(800+LEFT(伤害配置!$C$3,2)*8)+1))'
      '*(1+伤害配置!$B$1868)*IF(伤害配置!$N$1843<=0,1-(伤害配置!$N$1843)/2,IF(伤害配置!$N$1843<0.8,1-(伤害配置!$N$1843),'
      '1/(1+(伤害配置!$N$1843)*5)))*(1-MIN(伤害配置!$B$1893,1))*(1-MIN(伤害配置!$N$1893,1))*(1+伤害配置!$I$2150)'
      '*MAX((1+伤害配置!$B$1918)*(1+伤害配置!$C$1918)*(1+伤害配置!$D$1918)*(1+伤害配置!$E$1918)*(1+伤害配置!$F$1918)'
      '*(1+伤害配置!$G$1918)*(1+伤害配置!$H$1918)*(1+伤害配置!$I$1918)*(1+伤害配置!$J$1918),0)'
      '*MAX((1+伤害配置!$B$2026)*(1+伤害配置!$C$2026)*(1+伤害配置!$D$2026)*(1+伤害配置!$E$2026)*(1+伤害配置!$F$2026)'
      '*(1+伤害配置!$G$2026)*(1+伤害配置!$H$2026),0)*MAX((1+伤害配置!$N$2115),0)*MAX(1+伤害配置!$B$2115,0),1)')
E5 = D5.replace(')*1*MIN(', ')*(伤害配置!$N$1868)*MIN(', 1)


def mini_book(**cfg_over) -> dict:
    """够算 D5 / E5 的最小工作簿：散华 A1 倍率 4871、攻击 1928、全息 6 防御 1593、抗性 20%"""
    dmg = {f'{c}2': i for i, c in enumerate(['AH', 'AI', 'AJ', 'AK', 'AL', 'AM', 'AN', 'AO', 'AP', 'AQ'], start=1)}
    dmg.update({'A515': '散华', 'B515': 'A1', 'C515': '普攻第一段', 'AQ515': 4871})
    calc = {'C3': 1928, 'U3': 1593, 'A4': '散华', 'B4': '常态攻击 10级', 'D4': '未暴击', 'E4': '暴击', 'F4': '结算次数',
            'B5': '普攻第一段', 'D5': 485, 'E5': 1114, 'F5': 1}
    cfg = {'C3': 90, 'F3': 10, 'B2456': 0, 'B1818': 0, 'N1818': 0, 'B1868': 0.32, 'N1868': 2.3, 'N1843': 0.2,
           'B1893': 0, 'N1893': 0, 'N2115': 0, 'B2115': 0}
    for i, c in enumerate('BCDEFGHIJ', start=1):
        cfg[f'{c}1917'], cfg[f'{c}1918'] = f'冰A{i}', 0
    for i, c in enumerate('BCDEFGH'):
        cfg[f'{c}2025'], cfg[f'{c}2026'] = f'冰A{i}', 0
    cfg.update(cfg_over)
    return {CALC: calc, CFG: cfg, 'dmg': dmg}


class T03_10_公式解析与求值(unittest.TestCase):
    def ev(self, src, book=None, here='S'):
        e = Evaluator(book or {'S': {}})
        return e.scalar(e.parsed(src), here)

    def test_优先级(self):
        self.assertEqual(self.ev('=1+2*3^2'), 19)
        self.assertEqual(self.ev('=-2^2'), 4)                       # 负号先于乘方（Excel 规则）
        self.assertEqual(self.ev('=2*3&"x"'), '6x')                 # & 低于算术
        self.assertTrue(self.ev('=1+1=2'))                          # 比较最低
        self.assertEqual(self.ev('=50%*2'), 1)

    def test_引用与区域(self):
        n = strip_paren(parse("=SUM(伤害配置!$B$2179:伤害配置!$H$2179)+'a b'!C3+dmg!$A:$A"))
        refs = []

        def walk(x):
            if x.kind == 'ref':
                refs.append(x.value)
            for a in x.args:
                walk(a)
        walk(n)
        self.assertEqual([(r.sheet, r.c1, r.r1, r.c2, r.r2) for r in refs],
                         [('伤害配置', 2, 2179, 8, 2179), ('a b', 3, 3, 3, 3), ('dmg', 1, None, 1, None)])

    def test_MATCH_两列拼接与_INDEX(self):
        book = {'T': {'A1': '散华', 'C1': 'A1', 'A2': '散华', 'C2': 'E', 'D1': 10, 'D2': 20, 'E2': 30}, 'S': {'K1': '散华E'}}
        self.assertEqual(self.ev('=MATCH(K1,T!A1:A2&T!C1:C2,0)', book), 2)
        self.assertEqual(self.ev('=INDEX(T!D1:E2,MATCH(K1,T!A1:A2&T!C1:C2,0),2)', book), 30)
        with self.assertRaises(XlError):
            self.ev('=MATCH("无",T!A1:A2&T!C1:C2,0)', book)

    def test_取整与文本(self):
        self.assertEqual(self.ev('=CEILING(485.0000001,1)'), 486)
        self.assertEqual(self.ev('=FLOOR(1593.9,1)'), 1593)
        self.assertEqual(self.ev('=ROUND(2148.645,2)'), 2148.65)   # 按十进制四舍五入
        self.assertEqual(self.ev('=LEFT(90,2)*8'), 720)             # 数字当文本取左两位，再参与乘法
        self.assertEqual(num_text(0.1 + 0.2), '0.3')                # 拼接按 15 位有效数字
        self.assertEqual(self.ev('=IF(0<=0,1-0/2,1/0)'), 1)         # IF 只求选中的分支

    def test_D5_原公式重算(self):
        e = Evaluator(mini_book())
        self.assertEqual(e.scalar(e.parsed(D5), CALC), 485)
        self.assertEqual(e.scalar(e.parsed(E5), CALC), 1114)


class T01_9_标准答案条目(unittest.TestCase):
    def test_R5(self):
        book = mini_book()
        gd = golden.golden_damage(book[CALC], '秧秧·玄翎', golden.dmg_by_calc(book['dmg']))
        self.assertEqual(gd['entries'], [{'char': '散华', 'section': '常态攻击 10级', 'label': '普攻第一段', 'nonCrit': 485,
                                          'crit': 1114, 'ticks': 1, 'row': 5, 'col': 'B', 'dmgKey': ['散华', 'A1']}])
        self.assertEqual(gd['context']['char'], '秧秧·玄翎')


class T03_11_乘区拆分(unittest.TestCase):
    def classify(self, src, branch='nc', **cfg):
        book = mini_book(**cfg)
        e = Evaluator(book)
        g, why, notes = golden.Classifier(e).classify('D5', src, '普攻第一段', branch)
        self.assertIsNone(why)
        return g, notes

    def test_D5(self):
        g, notes = self.classify(D5)
        self.assertEqual(notes, [])
        self.assertEqual((g['formula'], g['key'], g['rate'], g['table']), ('hurt', '散华普攻第一段', 4871, 'dmg!AH'))
        z = g['z']
        self.assertAlmostEqual(z['base'], 939.1288, 9)
        self.assertEqual(z['crit'], 1)
        self.assertEqual(z['def'], {'targetDef': 1593, 'defRate': 0, 'ignore': 0, 'level': 90})
        self.assertEqual((z['bonus'], z['res'], z['dr'], z['dre'], z['special']), (0.32, 0.2, 0, 0, 0))
        self.assertEqual((z['amp'], z['fin'], z['fin1001'], z['amp0']), ([0] * 9, [0] * 8, 0, 0))
        g['expected'] = 485
        self.assertEqual(golden.recompute(g), 485)

    def test_E5_暴击列(self):
        g, _ = self.classify(E5, 'cr')
        self.assertEqual((g['branch'], g['z']['crit']), ('cr', 2.3))
        self.assertEqual(golden.recompute(g), 1114)

    def test_各乘区按位置与代码归类(self):
        """非中性值：减防、无视防御、减免、特殊、第 3 类加深、第 5 类最终伤害、1001 类、0 类加深都要落到对的槽"""
        g, _ = self.classify(D5, B2456=-0.1, B1818=0.12, N1818=0.05, B1893=0.3, N1893=-0.2, I2150=0.15,
                             D1918=0.25, G2026=0.4, N2115=0.1, B2115=0.36)
        z = g['z']
        self.assertAlmostEqual(z['def']['targetDef'], 1593 / 0.9, 9)
        self.assertAlmostEqual(z['def']['defRate'], -0.15, 12)
        self.assertAlmostEqual(z['def']['ignore'], 0.12, 12)
        self.assertEqual((z['dr'], z['dre'], z['special']), (0.3, -0.2, 0.15))
        self.assertEqual(z['amp'], [0, 0, 0.25, 0, 0, 0, 0, 0, 0])
        self.assertEqual(z['fin'], [0, 0, 0, 0, 0, 0.4, 0, 0])
        self.assertEqual((z['fin1001'], z['amp0']), (0.1, 0.36))
        e = Evaluator(mini_book(B2456=-0.1, B1818=0.12, N1818=0.05, B1893=0.3, N1893=-0.2, I2150=0.15,
                                D1918=0.25, G2026=0.4, N2115=0.1, B2115=0.36))
        self.assertEqual(golden.recompute(g), e.scalar(e.parsed(D5), CALC))

    def test_按状态切换的_IF_只拆选中的分支(self):
        src = D5.replace('*(1+伤害配置!$B$1868)*', '*IF(伤害配置!$E$344>0,(1+伤害配置!$C$1868),(1+伤害配置!$B$1868))*', 1)
        g, _ = self.classify(src, E344=0, C1868=0.9)
        self.assertEqual(g['z']['bonus'], 0.32)
        g, _ = self.classify(src, E344=1, C1868=0.9)
        self.assertEqual(g['z']['bonus'], 0.9)

    def test_未归类因子(self):
        g, notes = self.classify(D5.replace(')*1*MIN(', ')*1*1.5*MIN(', 1))
        self.assertEqual(g['z']['other'], 1.5)
        self.assertTrue(any('数字因子' in n for n in notes))

    def test_护盾不纳入(self):
        e = Evaluator(mini_book())
        g, why, _ = golden.Classifier(e).classify('P386', '=CEILING((2*$D$3+0)*(1+0),1)', 'C4-护盾量', 'nc')
        self.assertIsNone(g)
        self.assertEqual(why, '护盾')


if __name__ == '__main__':
    unittest.main()
