import { Cell } from '@ton/core';
const getRandom = (min:number, max:number) => {
    return Math.random() * (max - min) + min;
}

export const getRandomInt = (min: number, max: number) => {
    return Math.round(getRandom(min, max));
}
export class StorageStats {
    bits: bigint;
    cells: bigint;

    constructor(bits?: number | bigint, cells?: number | bigint) {
        this.bits  = bits  !== undefined ? BigInt(bits)  : 0n;
        this.cells = cells !== undefined ? BigInt(cells) : 0n;
    }
    add(...stats: StorageStats[]) {
        let cells = this.cells, bits = this.bits;
        for (let stat of stats) {
            bits  += stat.bits;
            cells += stat.cells;
        }
        return new StorageStats(bits, cells);
    }
    sub(...stats: StorageStats[]) {
        let cells = this.cells, bits = this.bits;
        for (let stat of stats) {
            bits  -= stat.bits;
            cells -= stat.cells;
        }
        return new StorageStats(bits, cells);
    }
    addBits(bits: number | bigint) {
        return new StorageStats(this.bits + BigInt(bits), this.cells);
    }
    subBits(bits: number | bigint) {
        return new StorageStats(this.bits - BigInt(bits), this.cells);
    }
    addCells(cells: number | bigint) {
        return new StorageStats(this.bits, this.cells + BigInt(cells));
    }
    subCells(cells: number | bigint) {
        return new StorageStats(this.bits, this.cells - BigInt(cells));
    }

    toString() : string {
        return JSON.stringify({
            bits: this.bits.toString(),
            cells: this.cells.toString()
        });
    }
}
export function collectCellStats(cell: Cell, visited:Array<string>, skipRoot: boolean = false): StorageStats {
    let bits  = skipRoot ? 0n : BigInt(cell.bits.length);
    let cells = skipRoot ? 0n : 1n;
    let hash = cell.hash().toString();
    if (visited.includes(hash)) {
        // We should not account for current cell data if visited
        return new StorageStats();
    }
    else {
        visited.push(hash);
    }
    for (let ref of cell.refs) {
        let r = collectCellStats(ref, visited);
        cells += r.cells;
        bits += r.bits;
    }
    return new StorageStats(bits, cells);
}
