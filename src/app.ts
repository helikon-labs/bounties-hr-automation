import { logger } from './logger';
import { Client } from '@notionhq/client';
import { dot } from '@polkadot-api/descriptors';
import { ksm } from '@polkadot-api/descriptors';
import { createClient } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws-provider/web';
import { withPolkadotSdkCompat } from 'polkadot-api/polkadot-sdk-compat';

function truncateAddress(address: string) {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function denominate(
    numerator: bigint,
    denominator: bigint,
    decimalPlaces: number = 4,
): number {
    if (denominator === 0n) {
        throw new Error('Division by zero.');
    }
    // handle sign
    const isNegative = numerator < 0n !== denominator < 0n;
    const absNumerator = numerator < 0n ? -numerator : numerator;
    const absDenominator = denominator < 0n ? -denominator : denominator;
    // integer part
    const integerPart = absNumerator / absDenominator;
    //fFractional part: multiply remainder by 10^decimalPlaces and divide
    const remainder = absNumerator % absDenominator;
    const multiplier = 10n ** BigInt(decimalPlaces);
    const fractionalPart = (remainder * multiplier) / absDenominator;
    // combine integer and fractional parts
    const result = Number(integerPart) + Number(fractionalPart) / Number(multiplier);
    return isNegative ? -result : result;
}

interface SubsquareBountyOnchainData {
    address: string;
}

interface SubsquareBounty {
    bountyIndex: number;
    title: string;
    state: string;
    onchainData: SubsquareBountyOnchainData;
}

interface SubsquareChildBountyOnchainData {
    value: number;
}

interface SubsquareChildBounty {
    index: number;
    onchainData: SubsquareChildBountyOnchainData;
}

interface SubsquareChildBounties {
    items: Array<SubsquareChildBounty>;
    total: number;
    page: number;
    pageSize: number;
}

class Application {
    constructor() {}

    async run() {
        const dotClient = createClient(
            withPolkadotSdkCompat(getWsProvider('wss://polkadot.dotters.network')),
        );
        const dotApi = dotClient.getTypedApi(dot);
        const ksmClient = createClient(
            withPolkadotSdkCompat(getWsProvider('wss://kusama.dotters.network')),
        );
        const ksmApi = ksmClient.getTypedApi(ksm);

        // @ts-ignore
        const notion = new Client({
            auth: process.env.NOTION_TOKEN,
        });
        const page = await notion.databases.query({
            database_id: '25f7df84dc8380ea88e0d4d6f421a7e5',
        });
        for (const object of page.results) {
            // @ts-ignore
            // console.log(object.properties);
            // @ts-ignore
            const id: number = object.properties.ID.number;
            // @ts-ignore
            const chain: string = (object.properties.Chain.select.name as string).toLowerCase();

            // get bounty
            const bountyResponse = await fetch(
                `https://${chain}-api.subsquare.io/treasury/bounties/${id}`,
                {
                    method: 'GET',
                },
            );
            if (!bountyResponse.ok) {
                const errorText = await bountyResponse.text();
                throw new Error(
                    `HTTP ${bountyResponse.status}: ${bountyResponse.statusText} :: ${errorText}`,
                );
            }
            const bounty: SubsquareBounty = await bountyResponse.json();
            logger.info(chain, bounty.bountyIndex, bounty.title, bounty.onchainData.address);

            // get child bounties
            let childBountiesTotal = BigInt(0);
            let childBountiesCount = 0;
            let childBountiesPage = 1;
            while (true) {
                const childBountiesResponse = await fetch(
                    `https://${chain}-api.subsquare.io/treasury/child-bounties?parentBountyId=${id}&page=${childBountiesPage}`,
                    {
                        method: 'GET',
                    },
                );
                if (!childBountiesResponse.ok) {
                    const errorText = await childBountiesResponse.text();
                    throw new Error(
                        `HTTP ${childBountiesResponse.status}: ${childBountiesResponse.statusText} :: ${errorText}`,
                    );
                }
                const childBounties: SubsquareChildBounties = await childBountiesResponse.json();
                childBountiesCount = childBounties.total;
                if (childBounties.items.length == 0) {
                    break;
                }
                for (const item of childBounties.items) {
                    childBountiesTotal += BigInt(item.onchainData.value);
                }
                childBountiesPage++;
            }
            logger.info(`${childBountiesCount} child bounties.`);

            // get balance
            let balance = 0;
            let childBountiesTotalDenom = 0;
            if (chain == 'polkadot') {
                const accountInfo = await dotApi.query.System.Account.getValue(
                    bounty.onchainData.address,
                );
                const denom = BigInt(Math.pow(10, 10));
                balance = denominate(accountInfo.data.free, denom);
                childBountiesTotalDenom = denominate(childBountiesTotal, denom);
            } else if (chain == 'kusama') {
                const accountInfo = await ksmApi.query.System.Account.getValue(
                    bounty.onchainData.address,
                );
                const denom = BigInt(Math.pow(10, 12));
                balance = denominate(accountInfo.data.free, denom);
                childBountiesTotalDenom = denominate(childBountiesTotal, denom);
            } else {
                throw Error(`Unknown chain: ${chain}`);
            }
            logger.info('pre-update');
            await notion.pages.update({
                page_id: object.id,
                properties: {
                    Balance: {
                        type: 'number',
                        number: balance,
                    },
                },
            });
            await notion.pages.update({
                page_id: object.id,
                properties: {
                    'Child bounty count': {
                        type: 'number',
                        number: childBountiesCount,
                    },
                },
            });
            await notion.pages.update({
                page_id: object.id,
                properties: {
                    'Child bounty sum': {
                        type: 'number',
                        number: childBountiesTotalDenom,
                    },
                },
            });
            await notion.pages.update({
                page_id: object.id,
                properties: {
                    Address: {
                        type: 'rich_text',
                        rich_text: [
                            {
                                type: 'text',
                                text: {
                                    content: truncateAddress(bounty.onchainData.address),
                                    link: {
                                        url: `https://${chain}.subscan.io/account/${bounty.onchainData.address}`,
                                    },
                                },
                            },
                        ],
                    },
                },
            });
            logger.info('post-update');
        }
        logger.info('done');
    }
}

export { Application };
