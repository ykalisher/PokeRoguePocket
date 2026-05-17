const NodeType = Object.freeze({
    WILD_AREA: 'WILD_AREA',
    MART: 'MART',
    NURSE: 'NURSE',
    ROCKET: 'ROCKET',
    TRAINER: 'TRAINER',
    BOSS: 'BOSS'
});

class Node {
    constructor(ntype, next = [], prev = []) {
        this.ntype = ntype;
        this.next = next;
        this.prev = prev;
    }
}
