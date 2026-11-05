// Minimal reproducer: JSC Proxy handler-traps cache, poly-proto handler.
// Sony WebKit-1400 (PS5 14.00) is missing the hasMonoProto guard added upstream.
function makePolyProtoObject() {
    function foo() {
        class C { constructor() { this._field = 42; } }
        return new C;
    }
    for (let i = 0; i < 15; ++i)
        foo();
    return foo();
}

const handler = makePolyProtoObject();
Object.setPrototypeOf(handler, Object.prototype);
handler.get = (target, key) => "got " + key;

const proxy = new Proxy({}, handler);
proxy.foo;

Object.setPrototypeOf(handler, null);
proxy.foo;

print("no crash");