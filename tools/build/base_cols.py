"""base 页的列按第 55 行的表头名找，不写死列字母（TD-01 §5）。

xlsx 更新时会插列：20261003 版在 O 后插了 PropExtraRate.Weakness&Ratio，其后各列右移一列，按字母读就全错了。
同名的表头（暴击、暴伤两列都叫 PhantomModel.SubAttribute.Rand901）按第几次出现区分。
"""
from __future__ import annotations

from openpyxl.utils import column_index_from_string as ci

_RAND = 'PhantomModel.SubAttribute.Rand'

# 构建用到的列在 20260707 版里的位置（表头名）。只给测试造表头用：数据行照旧按列字母写，表头按这里放
REFERENCE = {
    'M': 'PropExtraRateId', 'O': 'PropExtraRate.Tough&Rage',
    'R': 'WeaknessDamageMonsterCost', 'T': 'WeaknessDamageMinus', 'U': 'WeaknessDamageMinusRatio',
    'AM': 'AbnormalDamageLv', 'AO': 'WeaknessDamageBaseValue',
    'AP': 'RolePropertyGrowth.Level', 'AQ': 'RolePropertyGrowth.BreachLevel', 'AR': 'RolePropertyGrowth.LifeMaxRatio',
    'AS': 'RolePropertyGrowth.AtkRatio', 'AT': 'RolePropertyGrowth.DefRatio',
    'BB': 'PhantomBase.MainProp.Desc', 'BC': 'PhantomBase.MainProp.Cost',
    'BG': 'PhantomBase.SubProp.Desc', 'BH': 'PhantomBase.SubProp.Cost',
    'BR': _RAND + '1000701', 'BT': _RAND + '1000201', 'BV': _RAND + '1001001', 'BX': _RAND + '1000702',
    'BZ': _RAND + '1000202', 'CB': _RAND + '1001002', 'CD': _RAND + 'SkillType01', 'CF': _RAND + '901',
    'CH': _RAND + '901', 'CJ': _RAND + '1101',
    'CL': 'WeaponGrowth.Lv', 'CM': 'WeaponGrowth.Curve1.Ratio', 'CN': 'WeaponGrowth.Curve2.Ratio',
    'EM': 'Char.Proto_Id', 'EN': 'Char.Proto_LifeMax', 'EO': 'Char.Proto_Atk', 'EP': 'Char.Proto_Def',
    'EQ': 'Char.Proto_EnergyMax', 'EW': 'Char.Proto_ElementPropertyType', 'EX': 'Char.Proto_BreakWeaknessRatio',
    'EY': 'Char.Proto_WeaknessMastery',
    **{c: f'Char.Proto_SpecialEnergy{k + 1}Max' for k, c in enumerate(['ER', 'ES', 'ET', 'EU', 'EV'])},
    **{c: f'Char.Proto_SpecialEnergy{k + 1}Max.Desc' for k, c in enumerate(['EZ', 'FA', 'FB', 'FC', 'FD'])},
    **{c: f'Char.Chain{k + 1}' for k, c in enumerate(['FE', 'FF', 'FG', 'FH', 'FI', 'FJ'])},
    'FK': 'Char.passive1', 'FL': 'Char.passive2',
}


class BaseCols:
    """col(表头名, 第几个) → 0 起列下标；找不到就报错（表头改名了，构建停下来，改这里或改解析）"""

    def __init__(self, header) -> None:
        self.names = [str(h).strip() if h is not None else '' for h in header]

    def __call__(self, name: str, nth: int = 1) -> int:
        hits = [i for i, n in enumerate(self.names) if n == name]
        if len(hits) < nth:
            raise ValueError(f'base 页第 55 行找不到表头 {name}' + (f'（第 {nth} 个）' if nth > 1 else ''))
        return hits[nth - 1]

    @classmethod
    def reference(cls) -> 'BaseCols':
        """按 20260707 版的位置造的表头（测试用）"""
        head = [None] * 200
        for col, name in REFERENCE.items():
            head[ci(col) - 1] = name
        return cls(head)
