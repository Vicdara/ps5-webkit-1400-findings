// Bug 6 - GC re-entrancy in ErrorInstance::computeErrorInfo (missing DeferGC).
const N = 100, SIZE = 0x100000;
const err = (new Function("return (function () { arguments.callee.displayName = \"a\".repeat(" + SIZE + ") + \"b\"; ".repeat(N) + "return new Error();" + " })();".repeat(N)))();
const s = err.stack;
