// src/engine/num.ts —— 取整（总设计 §10.1）：引擎里"取到小数点后几位"都走这里，换语言时照这里的写法实现就能逐位一致。
// JS 的 Math.round(x) 取最接近的整数，正好一半时取较大的那个（2.5 → 3，−2.5 → −2）；Rust 的 f64::round 正好一半时远离 0（−2.5 → −3）。
// Rust 里要写成：let f = x.floor(); if x - f >= 0.5 { f + 1.0 } else { f }（对所有有限数都与 Math.round 相同，tests/num.test.ts）。
// 伤害公式里的向上取整（xlsx 的 CEILING）用 Math.ceil，两边语义相同，不经过这里。

/** JS Math.round 的语义（见文件头） */
export const round = (x: number): number => Math.round(x)
/** 取到 1/scale：round(x × scale) ÷ scale */
export const roundTo = (x: number, scale: number): number => Math.round(x * scale) / scale
/** 局部帧、判定年龄每次推进后取到 1e-4 帧：膨胀系数都是 1e-4 的整数倍，与整数帧比较不受浮点误差影响（TD-04 §2） */
export const snap4 = (x: number): number => roundTo(x, 1e4)
/** 资源加减后取到 1e-9：消掉 0.1 + 0.2 这类累加误差（TD-06） */
export const snap9 = (x: number): number => roundTo(x, 1e9)
