import { Blockchain, BlockchainTransaction, SandboxContract } from '@ton/sandbox';
import { beginCell, Cell, SendMode, toNano } from '@ton/core';
import { HighloadWalletV3S } from '../wrappers/HighloadWalletV3S';
import '@ton/test-utils';
import { getSecureRandomBytes, KeyPair, keyPairFromSeed } from "ton-crypto";
import { randomBytes } from "crypto";
import {SUBWALLET_ID} from "./imports/const";


describe('HighloadWalletV3S', () => {
    let keyPair: KeyPair;

    let blockchain: Blockchain;
    let highloadWalletV3S: SandboxContract<HighloadWalletV3S>;

    beforeAll(async () => {
        keyPair = keyPairFromSeed(await getSecureRandomBytes(32));
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
                }
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
