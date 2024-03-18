import { Blockchain, EmulationError, SandboxContract, createShardAccount } from '@ton/sandbox';
import { beginCell, Cell, Address, OutActionSendMsg, SendMode, toNano, Dictionary, BitString, BitBuilder } from '@ton/core';
import { HighloadWalletV3 } from '../wrappers/HighloadWalletV3';
import '@ton/test-utils';
import { getSecureRandomBytes, KeyPair, keyPairFromSeed } from "ton-crypto";
import { randomBytes } from "crypto";
import { SUBWALLET_ID } from "./imports/const";
import { Errors } from "./imports/const";
import { getRandomInt } from "../utils";
import { compile } from '@ton/blueprint';
import { findTransactionRequired } from '@ton/test-utils';


describe('HighloadWalletV3', () => {
    let keyPair: KeyPair;
    let code: Cell;

    let blockchain: Blockchain;
    let highloadWalletV3: SandboxContract<HighloadWalletV3>;
    let shouldRejectWith: (p: Promise<unknown>, code: number) => Promise<void>;
    let getContractData: (address: Address) => Promise<Cell>;

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
        getContractData = async (address: Address) => {
          const smc = await blockchain.getContract(address);
          if(!smc.account.account)
            throw("Account not found")
          if(smc.account.account.storage.state.type != "active" )
            throw("Atempting to get data on inactive account");
          if(!smc.account.account.storage.state.state.data)
            throw("Data is not present");
          return smc.account.account.storage.state.state.data
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
        const curTimeout = await highloadWalletV3.getTimeout();
        await shouldRejectWith(highloadWalletV3.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000 - getRandomInt(curTimeout + 1, curTimeout + 200),
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
    it('should work max bitNumber = 1022', async () => {
        await expect(highloadWalletV3.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000,
                shift: 0,
                bitNumber: 1022,
                actions: [],
                subwalletId: SUBWALLET_ID
            })).resolves.not.toThrow(EmulationError);
    });

    it('should reject with bitNumber = 1023', async () => {
        await expect(highloadWalletV3.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000,
                shift: 0,
                bitNumber: 1023,
                actions: [],
                subwalletId: SUBWALLET_ID
            })).rejects.toThrow(EmulationError);
    });
    // Just in case
    it('should work with max shift = 16383', async () => {
        await expect(highloadWalletV3.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000,
                shift: 16383,
                bitNumber: 0,
                actions: [],
                subwalletId: SUBWALLET_ID
            })).resolves.not.toThrow(EmulationError);
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

        const rndShift   = getRandomInt(0, 16383);
        const rndBitNum  = getRandomInt(0, 1022);

        const queryId = (rndShift << 10) + rndBitNum;

        const testResult1 = await highloadWalletV3.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000,
                shift: rndShift,
                bitNumber: rndBitNum,
                actions: [],
                subwalletId: SUBWALLET_ID
            }
        );
        expect(testResult1.transactions).toHaveTransaction({
            to: highloadWalletV3.address,
            success: true
        });

        expect(await highloadWalletV3.getProcessed(queryId)).toBe(true);
        blockchain.now = 1000 + 260;

        const newShift   = getRandomInt(0, 16383);
        const newBitNum  = getRandomInt(0, 1022);

        const newQueryId = (newShift << 10) + newBitNum;

        const testResult2 = await highloadWalletV3.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1200,
                shift: newShift,
                bitNumber: newBitNum,
                actions: [],
                subwalletId: SUBWALLET_ID
            }
        );
        expect(testResult2.transactions).toHaveTransaction({
            to: highloadWalletV3.address,
            success: true
        });
        expect(await highloadWalletV3.getProcessed(queryId)).toBe(false);
        expect(await highloadWalletV3.getProcessed(newQueryId)).toBe(true);
        expect(await highloadWalletV3.getLastCleaned()).toEqual(testResult2.transactions[0].now);
    });

    it('should send ordinary transaction and set processed accordingly', async () => {
        const testBody   = beginCell().storeUint(getRandomInt(0, 1000000), 32).endCell();

        const rndShift   = getRandomInt(0, 16383);
        const rndBitNum  = getRandomInt(0, 1022);

        const queryId = (rndShift << 10) + rndBitNum;

        const testResult = await highloadWalletV3.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000,
                shift: rndShift,
                bitNumber: rndBitNum,
                actions: [{
                    type: 'sendMsg',
                    mode: SendMode.NONE,
                    outMsg: {
                        info: {
                            type: 'external-out',
                            createdAt: 0,
                            createdLt: 0n
                        },
                        body: testBody
                    }
                }],
                subwalletId: SUBWALLET_ID
            }
        );

        const sentTx = findTransactionRequired(testResult.transactions, {
            to: highloadWalletV3.address,
            success: true,
            outMessagesCount: 1,
            actionResultCode: 0,
        });
        expect(sentTx.externals.length).toBe(1);
        expect(sentTx.externals[0].body).toEqualCell(testBody);

        const processed = await highloadWalletV3.getProcessed(queryId);
        expect(processed).toBe(true);
    });
    it('should handle max actions (255) in single batch', async () => {
        const baseInt = getRandomInt(0, 100000);
        const actions : OutActionSendMsg[] = new Array(255);
        const rndShift  = getRandomInt(0, 16383);
        const rndBitNum = getRandomInt(0, 1022);

        const queryId = (rndShift << 10) + rndBitNum;
        for(let i = 0; i < 255; i++) {
            actions[i] = {
                type: 'sendMsg',
                mode: SendMode.NONE,
                outMsg: {
                    info: {
                        type: 'external-out',
                        createdAt: blockchain.now!,
                        createdLt: blockchain.lt
                    },
                    body: beginCell().storeUint(baseInt + i, 32).endCell()
                }
            };
        }

        const res = await highloadWalletV3.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000,
                shift: rndShift,
                bitNumber: rndBitNum,
                actions,
                subwalletId: SUBWALLET_ID
            });

        const batchTx = findTransactionRequired(res.transactions, {
            on: highloadWalletV3.address,
            outMessagesCount: 255
        });

        expect(batchTx.externals.length).toBe(255);
        for(let i = 0; i < 255; i++) {
            expect(batchTx.externals[i].body).toEqualCell(actions[i].outMsg.body);
        }

        expect(await highloadWalletV3.getProcessed(queryId)).toBe(true);
    });
    it('queries dictionary with max keys should fit in credit limit', async () => {
        // 2 ** 14 - 1 = 16383 keys
        const newQueries = Dictionary.empty(Dictionary.Keys.Uint(14), Dictionary.Values.Cell());

        const padding = new BitString(Buffer.alloc(128, 0), 0, 1023 - 14);

        for(let i = 0; i < 16383; i++) {
            newQueries.set(i, beginCell().storeUint(i, 14).storeBits(padding).endCell());
        }

        const smc = await blockchain.getContract(highloadWalletV3.address);
        const walletState = await getContractData(highloadWalletV3.address);
        const ws   = walletState.beginParse();
        const head = ws.loadBits(256 + 32); // pubkey + subwallet
        const tail = ws.skip(2 + 40).loadBits(16);

        const newState = beginCell()
                          .storeBits(head)
                          .storeDict(null)
                          .storeDict(newQueries)
                          .storeUint(2000, 40) // Make dictionary is not nulled
                          .storeBits(tail)
                        .endCell();

        await blockchain.setShardAccount(highloadWalletV3.address, createShardAccount({
            address: highloadWalletV3.address,
            code,
            data: newState,
            balance: smc.balance,
            workchain: 0
        }));

        await expect(highloadWalletV3.sendExternalMessage(
            keyPair.secretKey,
            {
                createdAt: 1000,
                shift: getRandomInt(1, 16382),
                bitNumber: getRandomInt(0, 1022),
                actions: [{
                    type: 'sendMsg',
                    mode: SendMode.NONE,
                    outMsg: {
                        info: {
                            type: 'external-out',
                            createdAt: blockchain.now!,
                            createdLt: blockchain.lt
                        },
                        body: beginCell().storeUint(1234, 32).endCell(),
                    }}],
                subwalletId: SUBWALLET_ID
            })).resolves.not.toThrow();
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
