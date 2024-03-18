import { Blockchain, BlockchainTransaction, EmulationError, SandboxContract } from '@ton/sandbox';
import { beginCell, Cell, SendMode, toNano } from '@ton/core';
import { HighloadWalletV3 } from '../wrappers/HighloadWalletV3';
import '@ton/test-utils';
import { getSecureRandomBytes, KeyPair, keyPairFromSeed } from "ton-crypto";
import { randomBytes } from "crypto";
import { SUBWALLET_ID } from "./imports/const";
import { Errors } from "./imports/const";
import { getRandomInt } from "../utils";
import { compile } from '@ton/blueprint';


describe('HighloadWalletV3', () => {
    let keyPair: KeyPair;
    let code: Cell;

    let blockchain: Blockchain;
    let highloadWalletV3: SandboxContract<HighloadWalletV3>;
    let shouldRejectWith: (p: Promise<unknown>, code: number) => Promise<void>;

    beforeAll(async () => {
        keyPair = keyPairFromSeed(await getSecureRandomBytes(32));
        code    = await compile('HighloadWalletV3');
        shouldRejectWith = async (p, code) => {
            try {
                await p;
                throw new Error(`Should throw ${code}`);
            }
            catch(e: unknown) {
                if(e instanceof EmulationError) {
                    expect(e.exitCode !== undefined && e.exitCode == code).toBe(true);
                }
                else {
                    throw e;
                }
            }
        }
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

        highloadWalletV3 = blockchain.openContract(
            HighloadWalletV3.createFromConfig(
                {
                    publicKey: keyPair.publicKey,
                    subwalletId: SUBWALLET_ID,
                    timeout: 128
                },
                code
            )
        );

        const deployer = await blockchain.treasury('deployer');

        const deployResult = await highloadWalletV3.sendDeploy(deployer.getSender(), toNano('999999'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: highloadWalletV3.address,
            deploy: true
        });
    });

    it('should deploy', async () => {
        expect(await highloadWalletV3.getPublicKey()).toEqual(keyPair.publicKey);
    });

    it('should pass check sign', async () => {
        try {
            const testResult = await highloadWalletV3.sendExternalMessage(
                keyPair.secretKey,
                {
                    shift: 0,
                    bitNumber: 0,
                    createdAt: 1000,
                    actions: [],
                    subwalletId: SUBWALLET_ID
                }
            );

            expect(testResult.transactions).toHaveTransaction({
                to: highloadWalletV3.address,
                success: true
            });
        } catch (e: any) {
            console.log(e.vmLogs)
            // Otherwise test will never fail
            throw e;
        }
    });

    it('should fail check sign', async () => {
        let badKey: Buffer;
        // Just in case we win a lotto
        do {
            badKey = randomBytes(64);
        } while(badKey.equals(keyPair.secretKey));

        await shouldRejectWith(highloadWalletV3.sendExternalMessage(
            badKey,
            {
                createdAt: 1000,
                shift: 0,
                bitNumber: 0,
                actions: [],
                subwalletId: SUBWALLET_ID
            }
        ), Errors.invalid_signature);
    });

    it('should fail subwallet check', async () => {
        let badSubwallet;

        const curSubwallet= await highloadWalletV3.getSubwalletId();
        expect(curSubwallet).toEqual(SUBWALLET_ID);
        do {
            badSubwallet = getRandomInt(0, 1000);
        } while(badSubwallet == curSubwallet);

        await shouldRejectWith(highloadWalletV3.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000,
                shift: 0,
                bitNumber: 0,
                actions: [],
                subwalletId: badSubwallet
            }), Errors.invalid_subwallet);
    });

    it('should fail check created time', async () => {
        await shouldRejectWith(highloadWalletV3.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000 - getRandomInt(100, 200),
                shift: 0,
                bitNumber: 0,
                actions: [],
                subwalletId: SUBWALLET_ID
            }
        ), Errors.invalid_creation_time);
    });

    it('should fail check query_id in actual queries', async () => {
        const testResult = await highloadWalletV3.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000,
                shift: 0,
                bitNumber: 0,
                actions: [],
                subwalletId: SUBWALLET_ID
            }
        );
        expect(testResult.transactions).toHaveTransaction({
            to: highloadWalletV3.address,
            success: true
        });

        await shouldRejectWith(highloadWalletV3.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000,
                shift: 0,
                bitNumber: 0,
                actions: [],
                subwalletId: SUBWALLET_ID
            }
        ), Errors.already_executed)
    });

    it('should fail check query_id in old queries', async () => {
        const testResult = await highloadWalletV3.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000,
                shift: 0,
                bitNumber: 0,
                actions: [],
                subwalletId: SUBWALLET_ID
            }
        );
        expect(testResult.transactions).toHaveTransaction({
            to: highloadWalletV3.address,
            success: true
        });

        blockchain.now = 1000 + 100;

        await shouldRejectWith(highloadWalletV3.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1050,
                shift: 0,
                bitNumber: 0,
                actions: [],
                subwalletId: SUBWALLET_ID
            }
        ), Errors.already_executed)
    });

    it('should be cleared queries hashmaps', async () => {
        const testResult1 = await highloadWalletV3.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000,
                shift: 0,
                bitNumber: 0,
                actions: [],
                subwalletId: SUBWALLET_ID
            }
        );
        expect(testResult1.transactions).toHaveTransaction({
            to: highloadWalletV3.address,
            success: true
        });

        blockchain.now = 1000 + 260;

        const testResult2 = await highloadWalletV3.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1200,
                shift: 0,
                bitNumber: 0,
                actions: [],
                subwalletId: SUBWALLET_ID
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
                bitNumber: 0,
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
                }],
                subwalletId: SUBWALLET_ID
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
            if (x > 4) { blockchain.now = 1200; }
            for (let y = 0; y < 11; y++) {
                const testResult = await highloadWalletV3.sendExternalMessage(
                    keyPair.secretKey,
                    {
                        createdAt: x > 4 ? 1100  : 1000,
                        shift: x,
                        bitNumber: y < 5 ? 1022 - y : y,
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
                        }],
                        subwalletId: SUBWALLET_ID
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
