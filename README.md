# PS5 WebKit 14.00 — confirmed memory-safety findings

Findings against Sony's published WebKit source for **PS5 firmware 14.00**
(`WebKit_1400.zip`, sha256 `e6459745…d3be9db0`, verified).

**Status: 2026-11-05.** Seven bugs confirmed in the published source and reproduced
deterministically on x86-64 Linux with AddressSanitizer. None of them is confirmed on
console hardware. None of them gives code execution today.

## The finding that matters most

This is not a current WebKit tree. It is a **mid-2023 upstream snapshot** with selective
cherry-picks through Aug 2026. Sony's own patch log (`WebKit-1400-changes.txt`, 894 commits,
2023-06-08 → 2026-08-29) and direct source diffing both confirm it: the July-2023 Yarr fix
is present, September-2023 WebCore changes are not.

Consequence: every upstream memory-safety fix Sony never backported is potentially live.
That is the whole attack surface.

## Confirmed bugs

| # | Bug | Class | On PS5 | Release-visible |
|---|---|---|---|---|
| 1 | `HTMLMetaCharsetParser::extractCharset` | OOB read (2 bytes) | yes | no |
| 2 | `PNGImageDecoder::rowAvailable` (APNG) | OOB read (1 byte) | yes | no |
| 3 | `XSLTProcessor` teardown | double-free | **no** (`ENABLE_XSLT` off) | — |
| 4 | `ProxyObject::isHandlerTrapsCacheValid` | null deref | yes | **yes** |
| 5 | `Date#setTime` NaN | **type confusion → controlled 48-bit pointer** | yes | yes |
| 6 | `ErrorInstance::computeErrorInfo` | GC re-entrancy (rope UAF) | yes | yes |
| 7 | private brand in computed property name | null deref | yes | yes |

Full detail, code quotes, ASan stacks and upstream fix references: **[FINDINGS.md](FINDINGS.md)**.

## The open problem: bug 5 needs a leak

`Date#setTime` stores a raw NaN payload without purifying it, and `getTime()` returns a
JSValue whose cell pointer is attacker-controlled. Confirmed reach:

```
payload 0xfffe000000001234 -> fault at 0x1239
payload 0xfffe000041414141 -> fault at 0x41414146
payload 0xfffe7f0000414141 -> fault at 0x7f0000414146   (full 48-bit space)
```

Every operation tried so far reads the fake cell's Structure/TypeInfo before storing, so
without an address to aim at there is no read/write. **One heap address would convert this
into r/w.** That is what we are hunting.

## PoCs

All PoCs are unmodified upstream reproducers or minimal reductions.

```
pocs/meta-charset.html             # open in browser (or ASan build)
pocs/apng.html + .png              # open in browser
pocs/proxy-cache-crash.html        # crashes the web process on load (release too)
pocs/date-settime-type-confusion.js# jsc; reads at 0x41414141+5
pocs/error-instance.js             # jsc; UAF read while building error.stack
pocs/private-brand.js              # jsc; null deref at 0x5
pocs/xslt-double-free.html         # double-free; NOT on PS5
```

With a sanitizer build:

```
ASAN_OPTIONS=detect_leaks=0 LD_LIBRARY_PATH=build/extralibs:build/lib ./bin/jsc pocs/<file>.js
```

## Method

Run the regression tests that ship with upstream fixes against Sony's tree, under ASan.
~16,000 tests executed; 7 confirmed bugs. Reading patches by hand produced candidates and
zero bugs. See [METHOD.md](METHOD.md).

## What would help

- Firmware version and on-console behaviour of `proxy-cache-crash.html`
- The libxslt / libxml2 / libwebp versions shipped in 14.00
- A dump of the browser libraries, to confirm the tarball matches the binary

## Disclosure

Unpatched at time of writing. See [DISCLOSURE.md](DISCLOSURE.md).
