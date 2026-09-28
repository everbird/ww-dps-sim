"""nanoka 抽取（tools/build/nanoka.py）的离线用例：不联网，用人造的角色文件。

运行：pnpm test:py
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from nanoka import extract_character, fill  # noqa: E402


def lv(name, *vals, fmt='{0}秒'):
    return {'name': name, 'param': [list(vals)], 'format': fmt}


RAW = {
    'id': 1603, 'name': '椿',
    'skill_trees': {
        '2': {'skill': {'type': '共鸣技能', 'name': '盛放与凋零的轮舞', 'desc': '<color=Title>红椿</color>伤害{0}', 'param': ['57%'],
                        'level': {'1': lv('红椿盛绽伤害', '57.15%*2', '61.84%*2', fmt=None), '10': lv('冷却时间', *['4'] * 20)}}},
        '7': {'skill': {'type': '共鸣回路', 'name': '植物性宇宙', 'desc': '', 'param': [],
                        'level': {'3': lv('一日花冷却时间', *['25'] * 20)}}},
        '9': {'skill': {'name': '暴击伤害提升', 'desc': '暴击伤害提升{0}', 'param': ['2.40%']}},     # 属性节点：没有 type
        '3': {'skill': {'type': '共鸣解放', 'name': '甲', 'desc': '', 'param': [],
                        'level': {'2': lv('冷却时间', *(['20'] * 9 + ['18'] * 11))}}},
    },
    'chains': {'2': {'name': '二', 'desc': '倍率提升{0}', 'param': ['120%']}, '1': {'name': '一', 'desc': '无', 'param': []}},
}


class Nanoka抽取(unittest.TestCase):
    def test_fill(self):
        self.assertEqual(fill('<color=X>甲</color>造成{0}，{1}秒', ['10%', '8']), '甲造成10%，8秒')
        self.assertEqual(fill('缺{2}', ['a']), '缺{2}')

    def test_技能与冷却(self):
        c = extract_character(RAW)
        self.assertEqual([s['type'] for s in c['skills']], ['共鸣技能', '共鸣解放', '共鸣回路'])   # 按节点号排序，属性节点去掉
        self.assertEqual(c['skills'][0]['cooldowns'], [{'name': '冷却时间', 'seconds': 4.0, 'frames': 240}])
        self.assertEqual(c['skills'][0]['desc'], '红椿伤害57%')
        self.assertEqual(c['skills'][2]['cooldowns'][0]['frames'], 1500)

    def test_冷却随等级变化时取10级并标出(self):
        cd = extract_character(RAW)['skills'][1]['cooldowns'][0]
        self.assertEqual((cd['seconds'], cd['frames'], cd.get('variesByLevel')), (18.0, 1080, True))

    def test_共鸣链(self):
        self.assertEqual(extract_character(RAW)['chains'], [{'n': 1, 'name': '一', 'desc': '无'}, {'n': 2, 'name': '二', 'desc': '倍率提升120%'}])


if __name__ == '__main__':
    unittest.main()
