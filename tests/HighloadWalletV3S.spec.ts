import { Blockchain, BlockchainTransaction, SandboxContract } from '@ton/sandbox';
import { beginCell, Cell, SendMode, toNano } from '@ton/core';
import { HighloadWalletV3S } from '../wrappers/HighloadWalletV3S';
import '@ton/test-utils';
import { getSecureRandomBytes, KeyPair, keyPairFromSeed } from "ton-crypto";
import { randomBytes } from "crypto";
import {SUBWALLET_ID} from "./imports/const";
import { compile } from '@ton/blueprint';


describe('HighloadWalletV3S', () => {
    let keyPair: KeyPair;
    let code: Cell;

    let blockchain: Blockchain;
    let highloadWalletV3S: SandboxContract<HighloadWalletV3S>;

    beforeAll(async () => {
        keyPair = keyPairFromSeed(await getSecureRandomBytes(32));
        code    = await compile('HighloadWalletV3S');
    });

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        blockchain.now = 1000;
        // blockchain.verbosity = {
        //     print: true,
        //     blockchainLogs: true,
        //     vmLogs: 'vm_logs',
        //     debugLogs: true,
        // }

        highloadWalletV3S = blockchain.openContract(
            HighloadWalletV3S.createFromConfig(
                {
                    publicKey: keyPair.publicKey,
                    subwalletId: SUBWALLET_ID,
                    timeout: 128
                },
                code
            )
        );

        const deployer = await blockchain.treasury('deployer');

        const deployResult = await highloadWalletV3S.sendDeploy(deployer.getSender(), toNano('999999'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: highloadWalletV3S.address,
            deploy: true
        });
    });

    it('should deploy', async () => {
        expect(await highloadWalletV3S.getPublicKey()).toEqual(keyPair.publicKey);
    });

    it('should pass check sign', async () => {
        try {
            const message = highloadWalletV3S.createInternalTransfer({actions: [], queryId: 0, value: 0n})
            const testResult = await highloadWalletV3S.sendExternalMessage(
                keyPair.secretKey,
                {
                    createdAt: 1000,
                    shift: 0,
                    bitNumber: 0,
                    message,
                    mode: 128,
                    subwalletId: SUBWALLET_ID
                }
            );

            expect(testResult.transactions).toHaveTransaction({
                from: highloadWalletV3S.address,
                to: highloadWalletV3S.address,
                success: true,
            });
        } catch (e: any) {
            console.log(e.vmLogs)
        }

    });


    it('should fail check sign', async () => {
        const message = highloadWalletV3S.createInternalTransfer({actions: [], queryId: 0, value: 0n})
        await expect(highloadWalletV3S.sendExternalMessage(
            randomBytes(64),
            {
                createdAt: 1000,
                shift: 0,
                bitNumber: 0,
                message,
                mode: 128,
                subwalletId: SUBWALLET_ID
            }
        )).rejects.toThrow();
    });

    it('should fail subwallet check', async () => {
        let badSubwallet;

        const message = highloadWalletV3S.createInternalTransfer({actions: [], queryId: 0, value: 0n})
        const curSubwallet= await highloadWalletV3S.getSubwalletId();
        expect(curSubwallet).toEqual(SUBWALLET_ID);

        const rndShift   = getRandomInt(0, 16383);
        const rndBitNum  = getRandomInt(0, 1022);

        const queryId = (rndShift << 10) + rndBitNum;

        do {
            badSubwallet = getRandomInt(0, 1000);
        } while(badSubwallet == curSubwallet);

        await shouldRejectWith(highloadWalletV3S.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000,
                query_id: queryId,
                mode: 128,
                message,
                subwalletId: badSubwallet
            }), Errors.invalid_subwallet);
    });
    it('should fail check created time', async () => {
        const message = highloadWalletV3S.createInternalTransfer({actions: [], queryId: 0, value: 0n})
        await expect(highloadWalletV3S.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000 - 130,
                shift: 0,
                bitNumber: 0,
                message,
                mode: 128,
                subwalletId: SUBWALLET_ID
            }
        )).rejects.toThrow();
    });

    it('should fail check query_id in actual queries', async () => {
        const message = highloadWalletV3S.createInternalTransfer({actions: [], queryId: 0, value: 0n})
        const testResult = await highloadWalletV3S.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000,
                shift: 0,
                bitNumber: 0,
                message,
                mode: 128,
                subwalletId: SUBWALLET_ID
            }
        );
        expect(testResult.transactions).toHaveTransaction({
            from: highloadWalletV3S.address,
            to: highloadWalletV3S.address,
            success: true
        });

        await expect(highloadWalletV3S.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000,
                shift: 0,
                bitNumber: 0,
                message,
                mode: 128,
                subwalletId: SUBWALLET_ID
            }
        )).rejects.toThrow();
    });

    it('should fail check query_id in old queries', async () => {
        const message = highloadWalletV3S.createInternalTransfer({actions: [], queryId: 0, value: 0n})
        const testResult = await highloadWalletV3S.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000,
                shift: 0,
                bitNumber: 0,
                message,
                mode: 128,
                subwalletId: SUBWALLET_ID
            }
        );
        expect(testResult.transactions).toHaveTransaction({
            from: highloadWalletV3S.address,
            to: highloadWalletV3S.address,
            success: true
        });

        blockchain.now = 1000 + 100;

        await expect(highloadWalletV3S.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1050,
                shift: 0,
                bitNumber: 0,
                message,
                mode: 128,
                subwalletId: SUBWALLET_ID
            }
        )).rejects.toThrow();
    });

    it('should be cleared queries hashmaps', async () => {
        const message = highloadWalletV3S.createInternalTransfer({actions: [], queryId: 0, value: 0n})
        const testResult1 = await highloadWalletV3S.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000,
                shift: 0,
                bitNumber: 0,
                message,
                mode: 128,
                subwalletId: SUBWALLET_ID
            }
        );
        expect(testResult1.transactions).toHaveTransaction({
            from: highloadWalletV3S.address,
            to: highloadWalletV3S.address,
            success: true
        });

        blockchain.now = 1000 + 260;

        const testResult2 = await highloadWalletV3S.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1200,
                shift: 0,
                bitNumber: 0,
                message,
                mode: 128,
                subwalletId: SUBWALLET_ID
            }
        );
        expect(testResult2.transactions).toHaveTransaction({
            from: highloadWalletV3S.address,
            to: highloadWalletV3S.address,
            success: true
        });
    });

    it('should send ordinary transaction', async () => {

        const message = highloadWalletV3S.createInternalTransfer({actions: [{
                    type: 'sendMsg',
                    mode: SendMode.NONE,
                    outMsg: {
                        info: {
                            type: 'external-out',
                            createdAt: 0,
                            createdLt: 0n
                        },
                        body: beginCell().endCell()
                    }
                }], queryId: 0, value: 0n})
        const testResult = await highloadWalletV3S.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000,
                shift: 0,
                bitNumber: 0,
                message,
                mode: 128,
                subwalletId: SUBWALLET_ID
            }
        );

        expect(testResult.transactions).toHaveTransaction({
            from: highloadWalletV3S.address,
            to: highloadWalletV3S.address,
            success: true,
            outMessagesCount: 1,
            actionResultCode: 0
        });
    it('should handle 255 actions in one go', async () => {
        let outMsgs: OutActionSendMsg[] = new Array(255);

        for(let i = 0; i < 255; i++) {
            outMsgs[i] = {
                type: 'sendMsg',
                mode: SendMode.NONE,
                outMsg: internal_relaxed({
                    to: randomAddress(),
                    value: toNano('0.015'),
                    body: beginCell().storeUint(i, 32).endCell()
                }),
            }
        }

        const res = await highloadWalletV3S.sendBatch(keyPair.secretKey, outMsgs, SUBWALLET_ID, 0, 1000);

        expect(res.transactions).toHaveTransaction({
            on: highloadWalletV3S.address,
            outMessagesCount: 255
        });
        for(let i = 0; i < 255; i++) {
            expect(res.transactions).toHaveTransaction({
                from: highloadWalletV3S.address,
                body: outMsgs[i].outMsg.body
            })
        }
    });
    it('should be able to go beyond 255 messages with chained internal_transfer', async () => {
        const msgCount  = getRandomInt(256, 512);
        const msgs : OutActionSendMsg[] = new Array(msgCount);

        for(let i = 0; i < msgCount; i++) {
            msgs[i] = {
                type: 'sendMsg',
                mode: SendMode.PAY_GAS_SEPARATELY,
                outMsg: internal_relaxed({
                    to: randomAddress(0),
                    value: toNano('0.015'),
                    body: beginCell().storeUint(i, 32).endCell()
                })
            };
        }

        const res = await highloadWalletV3S.sendBatch(keyPair.secretKey, msgs, SUBWALLET_ID, 0, 1000);

        expect(res.transactions).toHaveTransaction({
            on: highloadWalletV3S.address,
            outMessagesCount: 255
        });
        expect(res.transactions).toHaveTransaction({
            on: highloadWalletV3S.address,
            outMessagesCount: msgCount - 254
        });
        for(let i = 0; i < msgCount; i++) {
            expect(res.transactions).toHaveTransaction({
                from: highloadWalletV3S.address,
                body: msgs[i].outMsg.body
            });
        }
    });

    it('should work replay protection, but dont send message', async () => {
        const testResult = await highloadWalletV3S.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000,
                shift: 0,
                bitNumber: 0,
                message: beginCell().storeUint(239, 17).endCell(),
                mode: 2,
                subwalletId: SUBWALLET_ID
            }
        );

        expect(testResult.transactions).toHaveTransaction({
            to: highloadWalletV3S.address,
            success: true,
            outMessagesCount: 0,
            actionResultCode: 0
        });
    });

});
