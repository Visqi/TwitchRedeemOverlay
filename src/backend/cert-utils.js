// filepath: f:\Projects\TwitchRedeemOverlay\src\backend\cert-utils.js
import { promisify } from 'util';
import { exec } from 'child_process';
import { generateKeyPairSync } from 'crypto';
import forge from 'node-forge';
import os from 'os';

// Promisify exec for async usage
const execAsync = promisify(exec);

/**
 * Generate self-signed SSL certificates
 * @returns {Promise<{cert: string, key: string}>} Object containing certificate and key as strings
 */
export async function generateSelfSignedCert() {
  try {
    // Using node-forge to generate certificates
    // This is a pure JS implementation that will work cross-platform
    console.log('Generating self-signed certificate...');
    
    // Generate a key pair
    const keys = forge.pki.rsa.generateKeyPair(2048);

    // Create a certificate
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    
    // Set certificate details
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
    
    // Set certificate subject and issuer fields
    const attrs = [
      { name: 'commonName', value: 'localhost' },
      { name: 'countryName', value: 'US' },
      { name: 'stateOrProvinceName', value: 'California' },
      { name: 'localityName', value: 'San Francisco' },
      { name: 'organizationName', value: 'Twitch Redeem Overlay' },
      { name: 'organizationalUnitName', value: 'Development' }
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    
    // Set extensions
    cert.setExtensions([
      {
        name: 'basicConstraints',
        cA: true
      },
      {
        name: 'keyUsage',
        keyCertSign: true,
        digitalSignature: true,
        nonRepudiation: true,
        keyEncipherment: true,
        dataEncipherment: true
      },
      {
        name: 'extKeyUsage',
        serverAuth: true,
        clientAuth: true
      },
      {
        name: 'subjectAltName',
        altNames: [
          {
            type: 2, // DNS
            value: 'localhost'
          },
          {
            type: 7, // IP
            ip: '127.0.0.1'
          }
        ]
      }
    ]);
    
    // Self-sign the certificate
    cert.sign(keys.privateKey, forge.md.sha256.create());
    
    // Convert to PEM format
    const certPem = forge.pki.certificateToPem(cert);
    const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
    
    return {
      cert: certPem,
      key: keyPem
    };
  } catch (err) {
    console.error('Error generating certificates:', err);
    throw err;
  }
}