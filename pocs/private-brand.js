// Bug 7 - empty private brand in computed property name (missing check_tdz).
class Test {
    static #method() { }
    ['foo'.#method];
}
