const qs = require('qs'),
    url = require('url'),
    jimp = require('jimp'),
    yargs = require('yargs'),
    qrcode = require('qrcode'),
    { prompt } = require('inquirer'),
    QRReader = require('qrcode-reader');

const qr = new QRReader();

const argv = yargs
    .detectLocale(false)
    .usage('$0 [<path/to/image>]')
    .help()
    .version(false)
    .argv;

const { _: [pathToImage] } = argv;

function decode(bitmap) {
    return new Promise((resolve, reject) => {
        qr.callback = (err, v) => err != null ? reject(err) : resolve(v);
        qr.decode(bitmap);
    });
}

function stringify({ type, account, ...query }) {
    return url.format({
        protocol: 'otpauth:',
        slashes: true,
        port: null,
        hostname: type,
        hash: null,
        query,
        pathname: account
    });
}

async function decodeImage(pathToImage) {
    const img = await jimp.read(pathToImage),
        { result } = await decode(img.bitmap),
        parsed = url.parse(result),
        params = qs.parse(parsed.query);

    const isValidOTPLink = parsed.protocol === 'otpauth:' &&
        parsed.hostname === 'totp' &&
        !!params.secret;

    if (!isValidOTPLink)
        throw new Error('This is not a valid TOTP QR code');

    let account = (parsed.pathname || '').replace(/^\//, '');

    params.issuer && (account = account.replace(new RegExp(`^${params.issuer}:`), ''));

    return {
        type: parsed.hostname,
        account,
        ...params
    };
}

function write(msg) {
    process.stderr.write(`${msg}\n`);
}

!async function() {
    let info = {},
        answers;

    if (pathToImage) {
        write('Reading the QR code...\n');
        info = await decodeImage(pathToImage);
    }

    answers = await prompt([
        {
            type: 'list',
            name: 'type',
            message: 'Choose the type of OTP',
            choices: [
                { name: 'Time-based OTP', value: 'totp' },
                { name: 'HMAC-based OTP', value: 'hotp' }
            ],
            default: 'totp',
            when: !info.type
        },
        {
            type: 'input',
            name: 'issuer',
            message: 'Enter the name of a provider or service',
            ...info.issuer ? { default: info.issuer } : {}
        },
        {
            type: 'input',
            name: 'account',
            message: 'Enter your account',
            ...info.account ? { default: info.account } : {}
        },
        {
            type: 'input',
            name: 'secret',
            message: 'Enter an OTP secret',
            validate: value => !!value || 'Secret is required!',
            when: !pathToImage
        },
        {
            type: 'list',
            name: 'algorithm',
            message: 'Choose an algorithm',
            choices: [
                { name: 'Skip and let app to choose default (usually SHA1)', short: 'Skipped', value: null },
                'SHA1',
                'SHA256',
                'SHA512'
            ],
            default: null,
            when: !pathToImage
        },
        {
            type: 'list',
            name: 'digits',
            message: 'Choose the length of passcode',
            choices: [6, 8],
            default: 6,
            when: !pathToImage
        },
        {
            type: 'number',
            name: 'period',
            message: 'Define a period that a TOTP code will be valid for (in seconds)',
            default: 30,
            when: ({ type }) => type === 'totp' && !pathToImage
        },
        {
            type: 'number',
            name: 'counter',
            message: 'Define the initial counter value',
            validate: value => !!value || 'Counter is required!',
            when: ({ type }) => type === 'hotp' && !pathToImage
        }
    ]);

    info = { ...info, ...answers };

    info.issuer && (info.account = `${info.issuer}:${info.account}`);
    info.secret = info.secret.replace(/\s/g, '');

    info = Object.keys(info).reduce((memo, key) => info[key] ? { ...memo, [key]: info[key] } : memo, {});

    let uri = stringify(info),
        code = await qrcode.toString(uri);

    write(`\nURI: ${uri}`);
    write('\nHere is a new QR code. Scan it with your OTP app:');
    write(code);
}();
