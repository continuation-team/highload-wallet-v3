import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    OutAction,
    Sender,
    SendMode,
    storeOutList
} from 'ton-core';
import { base64 as CodeBase64 } from '../build/HighloadWalletV3.compiled.json';
import { sign } from "ton-crypto";

export const HighloadWalletV3Code = Cell.fromBase64(CodeBase64);

export type HighloadWalletV3Config = {
    publicKey: Buffer
};


export function highloadWalletV3ConfigToCell(config: HighloadWalletV3Config): Cell {
    return beginCell()
          .storeBuffer(config.publicKey)
          .storeUint(0, 1 + 1 + 64)
          .endCell();
}


export class HighloadWalletV3 implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}


    static createFromAddress(address: Address) {
        return new HighloadWalletV3(address);
    }


    static createFromConfig(config: HighloadWalletV3Config, workchain = 0) {
        const data = highloadWalletV3ConfigToCell(config);
        const init = { code: HighloadWalletV3Code, data };
        return new HighloadWalletV3(contractAddress(workchain, init), init);
    }


    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            bounce: false,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }


    async sendExternalMessage(
        provider: ContractProvider,
        secretKey: Buffer,
        opts: {
            createdAt: number,
            shift: number,
            bitNumber: number,
            actions: OutAction[] | Cell
        }
    ){
        let actionsCell: Cell;
        if (opts.actions instanceof Cell) {
            actionsCell = opts.actions
        } else {
            const actionsBuilder = beginCell();
            storeOutList(opts.actions)(actionsBuilder);
            actionsCell = actionsBuilder.endCell();
        }
        const messageInner = beginCell()
                            .storeUint(opts.shift, 14)
                            .storeUint(opts.bitNumber, 10)
                            .storeUint(opts.createdAt, 40)
                            .storeRef(actionsCell)
                            .endCell();

        await provider.external(
            beginCell()
           .storeBuffer(sign(messageInner.hash(), secretKey))
           .storeRef(messageInner)
           .endCell()
        );
    }


    async getPublicKey(provider: ContractProvider): Promise<Buffer> {
        const res = (await provider.get('get_public_key', [])).stack;
        const pubKeyU = res.readBigNumber();
        return Buffer.from(pubKeyU.toString(16).padStart(32 * 2, '0'), 'hex');
    }
}