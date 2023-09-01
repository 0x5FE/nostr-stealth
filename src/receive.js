import {
    generatePrivateKey,
    getPublicKey,
    nip04,
    relayInit,
    getEventHash,
    getSignature
} from 'nostr-tools'
import 'websocket-polyfill'
import 'dotenv/config'
import { secp256k1 } from "@noble/curves/secp256k1";
import { base64 } from "@scure/base"
import * as crypto from "crypto";

globalThis.crypto = crypto;

// Test decryption of a message
async function test_decrypt(privkey, pubkey, data) {
    // Will validate that the data is a non-empty string
    if (typeof data !== 'string' || data.trim() === '') {
        throw new Error('Invalid data input');
    }
    
    var utf8Decoder = new TextDecoder("utf-8");
    let [ctb64, ivb64] = data.split("?iv=");
    let key = secp256k1.getSharedSecret(privkey, "02" + pubkey);
    let normalizedKey = getNormalizedX(key);
    let cryptoKey = await crypto.subtle.importKey(
        "raw",
        normalizedKey,
        { name: "AES-CBC" },
        false,
        ["decrypt"]
    );
    let ciphertext = base64.decode(ctb64);
    let iv = base64.decode(ivb64);
    try {
        let plaintext = await crypto.subtle.decrypt(
            { name: "AES-CBC", iv },
            cryptoKey,
            ciphertext
        );
        let text = utf8Decoder.decode(plaintext);
        return text;    
    } catch {
        return false;
    }
    
}

// Get the normalized X coordinate of a public key
function getNormalizedX(key) {
    return key.slice(1, 33);
}

// Initialize a relay object by calling the 'relayInit' function and passing the WebSocket URL as a parameter
const relay = relayInit(process.env.RELAY)

relay.on('connect', () => {
    console.log(`connected to ${relay.url}`)
})
relay.on('error', () => {
    console.log(`failed to connect to ${relay.url}`)
})

await relay.connect()

// Managing the keys

// receiver
let receiverPrivkey = process.env.RPRIV
let receiverPubkey = getPublicKey(receiverPrivkey)

let senderPubkey = process.env.SPUB

// channel pubkey
let channelPubkey = process.env.CHANPUB

// connect to relay and subscribe to events
let sub = await relay.sub([{
    kinds: [1337],
    "#p": [channelPubkey]
}])

// receive events
let events = []
sub.on('event', event => {
    // Will validate that event.content is a non-empty string
    if (typeof event.content !== 'string' || event.content.trim() === '') {
        console.error('Invalid event content');
        return;
    }
    events.push(event)
})
sub.on('eose', () => {
    decryptMessage(events[0])
    sub.unsub()
})

// decrypt message
async function decryptMessage(event){
    // Friends Pubs ([] of pubkeys of each friend you are communicating)
    let registeredSenderPubs = [
        senderPubkey
    ]

    for (let i in registeredSenderPubs) {
        
        // test decryption of the event
        let stealth_event = await test_decrypt(receiverPrivkey, registeredSenderPubs[i], event.content)
        // if decryption is successful, decrypt the message
        if (stealth_event != false) {
            let message = await nip04.decrypt(receiverPrivkey, JSON.parse(stealth_event).pubkey, JSON.parse(stealth_event).content)
            // console.log(event)
            console.log('\nPubkey:', JSON.parse(stealth_event).pubkey, '\n', message, '\n', stealth_event)
        }
    }
    // close the relay connection
    relay.close()
}

