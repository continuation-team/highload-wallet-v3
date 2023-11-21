import { Blockchain, BlockchainTransaction, SandboxContract } from '@ton-community/sandbox';
import { beginCell, Cell, SendMode, toNano } from 'ton-core';
import { HighloadWalletV3 } from '../wrappers/HighloadWalletV3';
import '@ton-community/test-utils';
import { getSecureRandomBytes, KeyPair, keyPairFromSeed } from "ton-crypto";
import { randomBytes } from "crypto";


describe('HighloadWalletV3', () => {
    let keyPair: KeyPair;

    let blockchain: Blockchain;
    let highloadWalletV3: SandboxContract<HighloadWalletV3>;

    beforeAll(async () => {
        keyPair = keyPairFromSeed(await getSecureRandomBytes(32));
    });

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        blockchain.now = 1000;

        highloadWalletV3 = blockchain.openContract(
            HighloadWalletV3.createFromConfig(
                {
                    publicKey: keyPair.publicKey
                }
            )
        );

        const deployer = await blockchain.treasury('deployer');

        const deployResult = await highloadWalletV3.sendDeploy(deployer.getSender(), toNano('999999'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: highloadWalletV3.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy', async () => {
        expect(await highloadWalletV3.getPublicKey()).toEqual(keyPair.publicKey);
    });

    it('should pass check sign', async () => {
        const testResult = await highloadWalletV3.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000,
                shift: 0,
                bitNumber: 1,
                actions: []
            }
        );

        testResult.transactions.forEach((tr: BlockchainTransaction) => {
            // console.log(tr.vmLogs)
            // console.log(tr.debugLogs)
            console.log(tr.description)
        })

        expect(testResult.transactions).toHaveTransaction({
            to: highloadWalletV3.address,
            success: true
        });
    });


    it('should fail check sign', async () => {
        await expect(highloadWalletV3.sendExternalMessage(
            randomBytes(64),
            {
                createdAt: 1000,
                shift: 0,
                bitNumber: 1,
                actions: []
            }
        )).rejects.toThrow();
    });

    it('should fail check created time', async () => {
        await expect(highloadWalletV3.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000 - 130,
                shift: 0,
                bitNumber: 1,
                actions: []
            }
        )).rejects.toThrow();
    });

    it('should fail check query_id in actual queries', async () => {
        const testResult = await highloadWalletV3.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000,
                shift: 0,
                bitNumber: 1,
                actions: []
            }
        );
        expect(testResult.transactions).toHaveTransaction({
            to: highloadWalletV3.address,
            success: true
        });

        await expect(highloadWalletV3.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000,
                shift: 0,
                bitNumber: 1,
                actions: []
            }
        )).rejects.toThrow();
    });

    it('should fail check query_id in old queries', async () => {
        const testResult = await highloadWalletV3.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000,
                shift: 0,
                bitNumber: 1,
                actions: []
            }
        );
        expect(testResult.transactions).toHaveTransaction({
            to: highloadWalletV3.address,
            success: true
        });

        blockchain.now = 1000 + 100;

        await expect(highloadWalletV3.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1050,
                shift: 0,
                bitNumber: 1,
                actions: []
            }
        )).rejects.toThrow();
    });

    it('should be cleared queries hashmaps', async () => {
        const testResult1 = await highloadWalletV3.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000,
                shift: 0,
                bitNumber: 1,
                actions: []
            }
        );
        expect(testResult1.transactions).toHaveTransaction({
            to: highloadWalletV3.address,
            success: true
        });

        blockchain.now = 1000 + 130;

        const testResult2 = await highloadWalletV3.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1100,
                shift: 0,
                bitNumber: 1,
                actions: []
            }
        );
        expect(testResult2.transactions).toHaveTransaction({
            to: highloadWalletV3.address,
            success: true
        });
    });

    it('should send ordinary transaction', async () => {
        const testResult = await highloadWalletV3.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000,
                shift: 0,
                bitNumber: 1,
                actions: [{
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
                }]
            }
        );

        expect(testResult.transactions).toHaveTransaction({
            to: highloadWalletV3.address,
            success: true,
            outMessagesCount: 1,
            actionResultCode: 0
        });
    });

    it('should send hundred ordinary transactions', async () => {
        for (let x = 0; x < 10; x++) {
            if (x > 4) { blockchain.now = 1100; }
            for (let y = 1; y < 11; y++) {
                const testResult = await highloadWalletV3.sendExternalMessage(
                    keyPair.secretKey,
                    {
                        createdAt: 1000,
                        shift: x,
                        bitNumber: y < 5 ? 1023 - y : y,
                        actions: [{
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
                        }]
                    }
                );

                expect(testResult.transactions).toHaveTransaction({
                    to: highloadWalletV3.address,
                    success: true,
                    outMessagesCount: 1,
                    actionResultCode: 0
                });
              }
        }
    });

});
