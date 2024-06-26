import puppeteer, { TimeoutError }  from 'puppeteer';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import 'dotenv/config'

const URL = 'https://statements.tnet.ge/en/statement/create?referrer=myhome';
// const SAMPLE_DIR = './assessment_sample';
// const INFO_FILE = "info.txt";
const SAMPLE_DIR = './sample_data';
const INFO_FILE = "results.txt";
const MAX_PHOTOS = 12;

async function startUp() {
    if (isProduction()) {
        console.log('Starting in production mode');
        const browser = await puppeteer.launch({
            headless: false,
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1080, height: 1024 });

        

        await login(page);
        return { browser, page }
    } else {
        console.log('Starting in development mode');
        let browser, page;
        try {
            [browser, page] = await connectToBrowser();
            await page.setViewport({ width: 1080, height: 1024 });
            console.log('Browder found, connecting')
        } catch (error) {
            console.log(error);
            console.log('Browser not found, starting a new one');
            await launchBrowser();
            [browser, page] = await connectToBrowser();
            await page.setViewport({ width: 1080, height: 1024 });
            await login(page);
        }
        return { browser, page }    
    }
}

function isProduction() {
    return process.env.ENV === 'production';
}

async function finish(browser){
    if (isProduction()) {
       // await browser.close();
    } else {
        await browser.disconnect();
    }

}

function launchBrowser() {
    return new Promise((resolve, reject) => {
        let args = puppeteer.defaultArgs();
        args = args.filter(arg => !arg.startsWith('--headless=new')).concat(['--remote-debugging-port=9222', '--window-size=1080,1024', '--incognito']);
        const browserProcess = spawn(process.env.CHROME_PATH, args, { detached: true });
        browserProcess.on('error', (error) => {
            reject(error);
        });

        browserProcess.stderr.on('data', (data) => {
            if (data.toString().includes('DevTools listening')) {
                resolve();
            }
        });
    });
}


async function connectToBrowser() {
    const res = await fetch("http://127.0.0.1:9222/json/version");
    const data = await res.json();
    const browser = await puppeteer.connect({
        browserWSEndpoint: data.webSocketDebuggerUrl
    });
    const [page] = await browser.pages();
    return [browser, page]
}


async function login(page) {
    if (page.url() !== URL) 
        await page.goto(URL, {
            waitUntil: ["domcontentloaded"],
            timeout: 0,
        });
    await page.locator('button').click();
    await page.waitForNavigation();
    await page.locator('#Email').fill(process.env.USER_EMAIL);
    await page.locator('#Password').fill(process.env.USER_PASSWORD);
    await page.locator('button').click();
    await page.waitForNavigation();
    await page.goto(URL, {
        waitUntil: ["load"],
        timeout: 0,
    });
}

async function loadPhotos(page, photos) {
    let input = await page.$('input[type="file"]');
    for (let i = 0; i < photos.length && i < MAX_PHOTOS; i++) {
        await input.uploadFile(photos[i]);
        if(i < MAX_PHOTOS - 1)
            input = await page.waitForSelector('input[type="file"]');
    }
}

async function chooseSelectorList(page, nameLabel, option = 0) {
    const labelParent = await page.$(`span ::-p-text(${nameLabel})`);
    const container = await labelParent?.evaluateHandle(el => el.parentElement?.parentElement);
    await labelParent?.click();
    const list = await container?.$$('li');
    const element = await list[option];
    await element?.click();
}

async function selectAllInFurnitureAndApplinces(page, panelName) {
    const h2Parent = await page.$(`h2 ::-p-text(${panelName})`);
    const parentDiv = await h2Parent.evaluateHandle(el => el.parentElement);
    const uncle = await parentDiv.evaluateHandle(el => el.parentElement.children[1]);
    const labels = await uncle.$$('label');
    for (let label of labels)
        await label.click();
}

async function fillInput(page, nameLabel, value, clean = false) {
    const labelParent = await page.$(`label ::-p-text(${nameLabel})`);
    const container = await labelParent?.evaluateHandle(el => el.parentElement);
    const input = await container?.$('input');
    if (clean) await input?.type("0");
    await input?.type(value);
}

async function fillNamesInput(page, value) {
    let container = await page.$('#\\33');
    let input = await container.$('input');
    await input?.type(value);

    container = await page.$('#\\35');
    input = await container.$('input');
    await input?.type(value);
}

async function chooseMainInformationOption(page, section, option) {
    const labelParent = await page.waitForSelector(`h2 ::-p-text(${section})`, { timeout: 0 });
    const container = await labelParent?.evaluateHandle(el => el.parentElement?.parentElement);
    const options = await container?.$$('label');
    await options[option].click();
}

async function listPhotos(dir) {
    try {
        const files = await fs.readdir(dir);
        return files.filter(file => file.endsWith(".jpg")).map(file => path.join(dir, file));
    } catch (error) {
        console.log(error);
        return [];
    }
}

async function solvePayment(page) {
    let buttonCardAndBalance;
    try{
        buttonCardAndBalance = await page.waitForSelector('span ::-p-text(Pay with card and balance)');
    } catch (error) {
        console.log('No payment needed. Skipping...');
        return;
    }
    await buttonCardAndBalance.click();

    const selector = '.luk-cursor-not-allowed';
    let elementExists = true;

    while (elementExists) {
        elementExists = await page.evaluate((selector) => {
            const element = document.querySelector(selector);
            return element !== null && element.className.includes('luk-cursor-not-allowed');
        }, selector);
    }
    const buttonsPaymentWithBalance = await page.$$('.luk-cursor-pointer');
    await buttonsPaymentWithBalance[2].click();

    const buttonConfirm = await page.waitForSelector('button ::-p-text(Pay-and-upload)');
    await buttonConfirm.click();
    await page.waitForNavigation();
}

async function fillPropertyInformation(page, property, photosPath) {
    // Predefined options
    await chooseMainInformationOption(page, 'Real estate type', parseInt(property.realEstateType));
    await chooseMainInformationOption(page, 'Deal type', parseInt(property.agreementType));

    const inputs = await page.$$('input')

    // Location
    await inputs[0].click();
    await inputs[0].type("Tbilisi");
    await page.locator('li ::-p-text(Tbilisi)').click();
    await inputs[1].type(property.address);
    await inputs[1].click();

    const directionListSelector = '.list-none > li'
    await page.waitForSelector(directionListSelector)
    await page.locator(directionListSelector).click();

    // Number of rooms
    const roomsSpan = await page.$('span ::-p-text(Rooms)');
    const parentDivRooms = await roomsSpan.evaluateHandle(el => el.parentElement);
    const firstUncleRooms = await parentDivRooms.evaluateHandle(el => el.parentElement.children[1]);
    const labelsRooms = await firstUncleRooms.$$('label');
    await labelsRooms[property.rooms - 1].click();

    // Number of bedrooms
    await page.waitForSelector('span ::-p-text(Bedroom)');
    const firstUncleBedroom = await parentDivRooms.evaluateHandle(el => el.parentElement.children[3]);
    const labelsBedroom = await firstUncleBedroom.$$('label');
    await labelsBedroom[parseInt(property.bedrooms) - 1].click();

    // Floors
    await fillInput(page, 'Floor', property.floor);
    await fillInput(page, 'Total floors', property.totalFloors);

    // Selectors 
    await chooseSelectorList(page, 'Choose status');
    await chooseSelectorList(page, 'Choose project type');

    // Furniture and appliances
    await selectAllInFurnitureAndApplinces(page, 'Furniture and appliances');

    // Pricing
    await fillInput(page, 'Area', property.area.replace(' m²', '').replace(' მ²', '').trim());
    await fillInput(page, 'Total price', property.priceUSD);
    await page.locator('div ::-p-text($)').click();

    // Details
    // await fillInput(page, 'Enter phone number', process.env.USER_PHONE, true);
    // await fillInput(page, 'Name', process.env.USER_NAME);
    await page.locator('textarea').fill(property.description);

    // Owner information
    await fillNamesInput(page, process.env.USER_NAME);
    await fillInput(page, 'Type phone number', process.env.USER_PHONE);

    // Load photos
    await loadPhotos(page, await listPhotos(photosPath));

    //VIP Stutus
    if (process.env.VIP_ALLOWED === "1" && property.vipStatus != null && property.vipStatus != undefined) {
        const serviceContainer = await page.$$('.services_container');
        const vipOptions = await serviceContainer[serviceContainer.length - 1].$$('.checkbox_container');
        await vipOptions[parseInt(property.vipStatus)].click();
    }

    // Submit
    await page.locator('button ::-p-text(Publish)').click();
    await page.waitForNavigation();
    
    // Paymnet
    if(process.env.ENABLE_PURCHASES === "1")
        await solvePayment(page);

        
}

async function processDirectory(directory, page) {
    const subdirectories = await fs.readdir(directory);
    for (const subdirectory of subdirectories) {
        const fullPath = path.join(directory, subdirectory);
        const stats = await fs.stat(fullPath);

        if (stats.isDirectory() === false) continue;

        const infoPath = path.join(fullPath, INFO_FILE);
        const content = await fs.readFile(infoPath, 'utf-8');
        const property = getPropertyInfo(content);
        console.log(`Processing property: ${subdirectory}`)
        await tryProcessProperty(page, property, fullPath);

        await page.goto(URL, {
            waitUntil: ["load"],
            timeout: 0,
        });

    }
}

function getPropertyInfo(propertyStr) {
    let property = JSON.parse(propertyStr);
    const propertyDefaults = {
        ...property,
        realEstateType: property.realEstateType || "0",
        floor: property.floor || "0",
        priceUSD: property.priceUSD || property.price || "0",
        bedrooms: property.bedrooms || "1"
    }
    propertyDefaults.priceUSD = propertyDefaults.priceUSD.replace(',', '');
    return propertyDefaults;
}


async function tryProcessProperty(page, property, fullPath) {
    try {
        await fillPropertyInformation(page, property, fullPath);
    } catch (error) {
        if (error instanceof TimeoutError) {
            const maxRetries = 3;
            for (let i = 0; i < maxRetries; i++) {
                try {
                    await fillPropertyInformation(page, property, fullPath);
                } catch (error) {
                    if (error instanceof TimeoutError) {
                        console.error(`Attempt ${i} failed: Navigation timed out`);
                        if (i === maxRetries) {
                            console.error('Max retries reached. Giving up.');
                        }
                    } else {
                        throw error;
                    }
                }
            }
        } else {
            throw error;
        }
    }
}


async function main() {
    let {browser, page } = await startUp();
    try {
        if (page.url() !== URL) 
            await page.goto(URL, {
                waitUntil: ["load"],
                timeout: 0,
            });
        await processDirectory(SAMPLE_DIR, page);
        await page.goto("https://www.myhome.ge/ka/my/products");
    } catch (error) {
        console.log(error);
    } finally {
        await finish(browser);
    }
}


(async () => {
    await main();
})();