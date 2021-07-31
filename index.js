const { Input, Select } = require('enquirer')
const fs = require('fs/promises')
const { chmod } = require('fs/promises')
const util = require('util')
const exec = util.promisify(require('child_process').exec)
const chalk = require('chalk')

const HOME_DATA = '/home/data'
const log = console.log
const ok = chalk.green('successful')
const err = chalk.red
const info = chalk.blue

async function genpw () {
  const sslCsrCmd = `openssl rand -hex 32`
  const { stdout, stderr } = await exec(sslCsrCmd, { encoding: 'utf-8' })
  return stdout.replace(/[\r\n]/g, '')
}

async function query (question) {
  const prompt = new Input({
    message: question,
    initial: ''
  })

  const answer = await prompt.run()
  return answer
}

async function getPassphrase () {
  const choiceAutoPw = 'Auto generate the passphrase'
  const choiceSupplyPw = 'Provide my passphrase'
  const choiceNoPw = 'No passphrase'

  const selectPwChoice = new Select({
    name: 'mainmenu',
    message:
      'Do you want to auto generate the passphrase, provide your own passphrase or no passphrase?',
    choices: [choiceAutoPw, choiceSupplyPw, choiceNoPw]
  })

  const answer = await selectPwChoice.run()
  if (answer === choiceAutoPw) {
    const pw = await genpw()
    log('Generated passphrase is:')
    log(info(pw))
    return pw
  } else if (answer === choiceSupplyPw) {
    const pw = await query('Please type your passphrase')
    log(info(pw))
    return pw
  } else {
    log(info('No passphrase is required'))
    return ''
  }
}

async function createPrivateKeyForCA (password) {
  const privateKeyDir = `${HOME_DATA}/ca/private`
  const keyFilePath = `${privateKeyDir}/ca.key.pem`
  const bitPairs = 4096

  try {
    await fs.mkdir(`${privateKeyDir}`, { recursive: true })
    await chmod(`${privateKeyDir}`, 0o700)
    await fs.writeFile(`${HOME_DATA}/ca/index.txt`, '')
    await fs.writeFile(`${HOME_DATA}/ca/serial`, '1000')
    await exec(
      `openssl genrsa -aes256 -passout pass:${password} -out ${keyFilePath} ${bitPairs}`
    )
    ////await chmod(keyFilePath, 0o400)
    log(`Create CA private key ${ok}`)
  } catch (e) {
    log(err('Error ', e))
  }
}

async function createCertificateForCA (baseName, password) {
  const orgName = `${baseName} Ltd`
  const commonName = `${baseName} Ltd Certificate Authority`
  const country = 'US'
  const province = 'TX'

  const sslCmdCreateRootCaCert = `openssl req -config root.ca.openssl.cnf \
    -key ${HOME_DATA}/ca/private/ca.key.pem -new -x509 -passin pass:${password} -days 7300 -sha256 -extensions v3_ca \
    -subj "/C=${country}/ST=${province}/O=${orgName}/CN=${commonName}" \
    -out ${HOME_DATA}/ca/certs/ca.cert.pem`

  try {
    await fs.mkdir(`${HOME_DATA}/ca/certs`, { recursive: true })
    await exec(sslCmdCreateRootCaCert)

    log(`Create CA certificate ${info('ca/certs/ca.cert.pem')} ${ok}`)
  } catch (e) {
    log(err('Error ', e))
  }
}

async function createPrivateKeyForEndUser (password) {
  const privateKeyDir = `${HOME_DATA}/eu/private`
  const keyFilePath = `${privateKeyDir}/key.pem`
  const bitPairs = 2048

  try {
    await fs.mkdir(`${privateKeyDir}`, { recursive: true })
    if (!password || password.length === 0) {
      await exec(`openssl genrsa -out ${keyFilePath} ${bitPairs}`)
    } else {
      await exec(
        `openssl genrsa -aes256 -passout pass:${password} -out ${keyFilePath} ${bitPairs}`
      )
    }
    ////await chmod(keyFilePath, 0o400)
    log(`Create End User private key ${info('eu/private/key.pem')} ${ok}`)
  } catch (e) {
    log(err('Error ', e))
  }
}

async function createCSREndUser (baseName, password, dns) {
  const orgName = `${baseName} Ltd`
  const commonName = `${baseName} Ltd Web Client`
  const country = 'US'
  const province = 'TX'

  const addDnsToSANCmd = `echo && echo "DNS.2 = ${dns}" >> temp.cnf && \
    cat enduser.openssl.cnf temp.cnf > ${HOME_DATA}/san.openssl.cnf && \
    rm temp.cnf`

  const cpToSAN = `cp enduser.openssl.cnf ${HOME_DATA}/san.openssl.cnf`

  const sslCsrCmd = `openssl req -new -key ${HOME_DATA}/eu/private/key.pem -passin pass:${password} \
    -subj "/C=${country}/ST=${province}/O=${orgName}/CN=${commonName}" \
    -out ${HOME_DATA}/eu/csr/csr.pem -config ${HOME_DATA}/san.openssl.cnf`

  try {
    if (dns && dns.length > 0) {
      await exec(addDnsToSANCmd)
    } else {
      await exec(cpToSAN)
    }
    await fs.mkdir(`${HOME_DATA}/eu/csr`, { recursive: true })
    await exec(sslCsrCmd)

    log(`Create End User CSR ${ok}`)
  } catch (e) {
    log(err('Error ', e))
  }
}

async function createCreateCertFromCSR (password) {
  const sslCertCmd = `openssl x509 -req \
  -in ${HOME_DATA}/eu/csr/csr.pem \
  -CA ${HOME_DATA}/ca/certs/ca.cert.pem \
  -CAkey ${HOME_DATA}/ca/private/ca.key.pem \
  -CAcreateserial \
  -passin pass:${password} \
  -out ${HOME_DATA}/eu/certs/cert.pem \
  -days 10 -sha256 \
  -extensions req_ext -extfile ${HOME_DATA}/san.openssl.cnf`

  try {
    await fs.mkdir(`${HOME_DATA}/eu/certs`, { recursive: true })
    await exec(sslCertCmd)

    log(`Create End User Certificate ${info('eu/certs/cert.pem')} ${ok}`)
  } catch (e) {
    log(err('Error ', e))
  }
}

async function createP12 (password) {
  const sslP12Cmd =
    password && password.length > 0
      ? `openssl pkcs12 -export -passin pass:${password} -passout pass:${password} -inkey ${HOME_DATA}/eu/private/key.pem -in ${HOME_DATA}/eu/certs/cert.pem -out ${HOME_DATA}/eu/certs/cert.p12`
      : `openssl pkcs12 -export -passout pass:${password} -inkey ${HOME_DATA}/eu/private/key.pem -in ${HOME_DATA}/eu/certs/cert.pem -out ${HOME_DATA}/eu/certs/cert.p12`
  try {
    await exec(sslP12Cmd)
    log(`Create End User P12 Certificate ${info('eu/certs/cert.12')} ${ok}`)
  } catch (e) {
    log(err('Error ', e))
  }
}

async function main () {
  const uname = await query('What is your name or organization name?')
  log(info(uname))
  log('Localhost is already included by default.')
  const sDns = await query(
    'What is the additional DNS name of your server (leave blank if none)?'
  )
  if (sDns && sDns.length > 0) {
    log(info('localhost'))
    log(info(sDns))
  } else {
    log(info('localhost'))
  }
  const pwCA = await genpw()
  const pwEU = await getPassphrase()
  await createPrivateKeyForCA(pwCA)
  await createCertificateForCA(uname, pwCA)
  await createPrivateKeyForEndUser(pwEU)
  await createCSREndUser(uname, pwEU, sDns)
  await createCreateCertFromCSR(pwCA)
  await createP12(pwEU)
}

main()
