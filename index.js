const { Input, Select, Confirm, Password } = require('enquirer')
const fs = require('fs/promises')
const { access, chmod } = require('fs/promises')
const { constants } = require('fs')
const util = require('util')
const exec = util.promisify(require('child_process').exec)
const chalk = require('chalk')

const HOME_DATA = '/home/data'
const log = console.log
const ok = chalk.green('successful')
const err = chalk.red
const info = chalk.blue

async function genpw (size) {
  const sslCsrCmd = `openssl rand -hex ${size}`
  const { stdout, stderr } = await exec(sslCsrCmd, { encoding: 'utf-8' })
  return stdout.replace(/[\r\n]/g, '')
}

async function query (question, forceAnswer) {
  const prompt = new Input({
    message: question,
    initial: ''
  })

  const answer = await prompt.run()
  if (answer || !forceAnswer) {
    return answer
  } else {
    const prompt = new Input({
      message: `${err(
        "If you don't answer again, the program, will exit\n\r"
      )} ${question}`,
      initial: ''
    })
    const answer = await prompt.run()
    if (answer) {
      return answer
    } else {
      log(err('Good bye'))
      process.exit()
    }
  }
}

async function promptForPasswordAndConfirm () {
  let password = ''
  let passwordConfirm = ''

  while (
    (password === '' && passwordConfirm === '') ||
    password !== passwordConfirm
  ) {
    password = await promptPassword(`Please type your passphrase`)
    passwordConfirm = await promptPassword(
      `To confirm there\s no typo, please type your passphrase again`
    )

    if (password !== passwordConfirm) {
      console.log('Passwords do not match. Please try again.')
      console.log()
    } else if (password === '' || passwordConfirm === '') {
      console.log(
        'Passwords cannot be left blank. Please try to enter a password.'
      )
      console.log()
    } else if (password.length < 6 || password.length > 1023) {
      console.log('Password must have between 6 to 1023 characters.')
      console.log()
      password = ''
      passwordConfirm = ''
    }
  }

  return password
}

async function writeToFile (filePath, content) {
  try {
    await fs.writeFile(filePath, content, { encoding: 'utf-8' })
  } catch (e) {
    log(err('Error writeToFile', e))
    log(info(content))
  }
}

async function removeFile (filePath) {
  try {
    await fs.unlink(filePath)
  } catch (e) {
    log(err('Error removeFile', e))
  }
}

async function promptAutoGenerate () {
  const choiceAuto = 'Yes, auto generate everything'
  const choiceManual = 'No, I want to control each answer'

  const selectAutoGenerate = new Select({
    name: 'menu',
    message: 'Do you want to auto generate everything or control each answer?',
    choices: [choiceAuto, choiceManual]
  })

  const answer = await selectAutoGenerate.run()
  return answer === choiceAuto ? true : false
}

async function getEUPassphrase () {
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
    const pw = await genpw(6)
    const filePath = 'eu/passphrase.txt'
    await writeToFile(`${HOME_DATA}/${filePath}`, pw)
    log(`Generated passphrase for certificate is written to ${info(filePath)}`)
    return pw
  } else if (answer === choiceSupplyPw) {
    const pw = await promptForPasswordAndConfirm()
    log(info('You passphrase is accepted'))
    const filePath = 'eu/passphrase.txt'
    const passFileExists = await fileExists(`${HOME_DATA}/${filePath}`)
    if (passFileExists) {
      await removeFile(`${HOME_DATA}/${filePath}`)
    }
    return pw
  } else {
    log(info('No passphrase is required'))
    return ''
  }
}

async function getCAPassphrase () {
  const choiceAutoPw = 'Auto generate the passphrase'
  const choiceSupplyPw = 'Provide my passphrase'

  const selectPwChoice = new Select({
    name: 'mainmenu',
    message:
      'Do you want to auto generate the passphrase or provide your own passphrase?',
    choices: [choiceAutoPw, choiceSupplyPw]
  })

  const answer = await selectPwChoice.run()
  if (answer === choiceAutoPw) {
    const pw = await genpw(32)
    const filePath = 'ca/passphrase.txt'
    await writeToFile(`${HOME_DATA}/${filePath}`, pw)
    log(`Generated passphrase for CA is written to to ${info(filePath)}`)
    return pw
  } else if (answer === choiceSupplyPw) {
    const pw = await promptForPasswordAndConfirm()
    log(info('You passphrase is accepted'))
    const filePath = 'ca/passphrase.txt'
    const passFileExists = await fileExists(`${HOME_DATA}/${filePath}`)
    if (passFileExists) {
      await removeFile(`${HOME_DATA}/${filePath}`)
    }
    return pw
  } else {
    log(err('Something not right in getCAPassphrase'))
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
    log(err('Error createPrivateKeyForCA', e))
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
    log(err('Error createCertificateForCA', e))
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
    log(err('Error createPrivateKeyForEndUser', e))
  }
}

async function createCSREndUser (orgName, commonName, password, dns) {
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
    log(err('Error createCSREndUser', e))
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
    log(err('Error createCreateCertFromCSR', e))
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
    log(err('Error createP12', e))
  }
}

async function isCAPasswordCorrect (password) {
  const sslCmd = `openssl rsa -noout -in ${HOME_DATA}/ca/private/ca.key.pem -passin "pass:${password}"`
  try {
    await exec(sslCmd)
    return true
  } catch {
    return false
  }
}

async function isCAPasswordFromFileCorrect (filePath) {
  const sslCmd = `openssl rsa -noout -in ${HOME_DATA}/ca/private/ca.key.pem -passin "file:${filePath}"`
  try {
    const { stdout, stderr } = await exec(sslCmd)
    return true
  } catch (e) {
    log(err('Error isCAPasswordFromFileCorrect', e))
    return false
  }
}

async function extractCNFromCert (certFile) {
  const sslCmd = `openssl x509 -noout -subject -in ${certFile}`
  try {
    const { stdout, stderr } = await exec(sslCmd, { encoding: 'utf-8' })
    const tokens = stdout
      .split(',')
      .map(t => t.replace(/[\'\r\n]/g, ''))
      .map(t => t.trim())

    const orgToken = tokens.filter(t => t.startsWith('O'))
    const orgTokens = orgToken[0].split('=')

    const cnToken = tokens.filter(t => t.startsWith('CN'))
    const cnTokens = cnToken[0].split('=')
    return [orgTokens[1].trim(), cnTokens[1].trim()]
  } catch (e) {
    log(err('Error extractCNFromCert', e))
  }
}

async function extractPassphraseFromFile (textFile) {
  try {
    const pw = await fs.readFile(textFile, { encoding: 'utf-8' })
    return pw
  } catch (e) {
    return undefined
  }
}

async function fileExists (filePath) {
  let exists = false
  try {
    await access(filePath, constants.R_OK)
    exists = true
  } catch {}
  return exists
}

async function checkCAExists () {
  const privateKeyDir = `${HOME_DATA}/ca/private`
  const caKeyFilePath = `${privateKeyDir}/ca.key.pem`
  const caCertDir = `${HOME_DATA}/ca/certs`
  const caCertFilePath = `${caCertDir}/ca.cert.pem`

  const caKeyFileExists = await fileExists(caKeyFilePath)
  const caCertFileExists = await fileExists(caCertFilePath)

  return caKeyFileExists && caCertFileExists
}

async function promptOverrideCA () {
  log()
  const promptOverride = new Confirm({
    name: 'confirmOverrideCA',
    message: 'Do you want to create a new CA?'
  })

  const answer = await promptOverride.run()
  return answer
}

async function startFresh () {
  const uname = await query('What is your name or organization name?', true)
  log(info(uname))
  log('Localhost is already included by default.')
  const sDns = await query(
    'What is the additional DNS name of your server (leave blank if none)?',
    false
  )
  if (sDns && sDns.length > 0) {
    log(info('localhost'))
    log(info(sDns))
  } else {
    log(info('localhost'))
  }

  let pwCA
  let pwEU

  const autogenerate = await promptAutoGenerate()
  if (autogenerate) {
    pwCA = await genpw(32)
    const caPassFilePath = 'ca/passphrase.txt'
    await writeToFile(`${HOME_DATA}/${caPassFilePath}`, pwCA)
    log(`Generated passphrase for CA is written to ${info(caPassFilePath)}`)

    pwEU = await genpw(6)
    const euPassFilePath = 'eu/passphrase.txt'
    await writeToFile(`${HOME_DATA}/${euPassFilePath}`, pwEU)
    log(
      `Generated passphrase for certificate is written to ${info(
        euPassFilePath
      )}`
    )
  } else {
    log(
      chalk.bold(
        `The CA Certificate ${info('must be encrypted')} with a passphrase.`
      )
    )
    pwCA = await getCAPassphrase()

    log(
      'Similarly, the signed certificate to run your server can also be encrypted but does not have to.'
    )
    pwEU = await getEUPassphrase()
  }

  await createPrivateKeyForCA(pwCA)
  await createCertificateForCA(uname, pwCA)
  await createPrivateKeyForEndUser(pwEU)

  const orgName = `${uname} Ltd`
  const commonName = `${uname} Ltd Web Client`

  await createCSREndUser(orgName, commonName, pwEU, sDns)
  await createCreateCertFromCSR(pwCA)
  await createP12(pwEU)
}

async function startNewEU (pwCA, euOrg, euCN) {
  const sDns = await query('What is the DNS name of your server?', true)
  log(info(sDns))
  const pwEU = await getEUPassphrase()
  await createPrivateKeyForEndUser(pwEU)
  await createCSREndUser(euOrg, euCN, pwEU, sDns)
  await createCreateCertFromCSR(pwCA)
  await createP12(pwEU)
}

async function promptPassword (message) {
  const promptPassword = new Password({
    name: 'passwd',
    message
  })
  const password = await promptPassword.run()
  return password
}

async function handleExistingCANoPasswd (caCN, euCN, euOrg) {
  log(`Your self-signed CA, ${info(caCN)} is already established.`)
  log(
    'You should continue using it to sign new certificates for more DNS servers.'
  )
  log(
    'If you forgot its passphrase, you can delete its private key, certificate and create a new CA.'
  )
  const override = await promptOverrideCA()
  if (override) {
    await startFresh()
  } else {
    const existingPasswd = await promptPassword(
      `What is the passphrase for your exsisting self-signed CA ${info(caCN)}?`
    )
    if (existingPasswd.length > 0) {
      const validCAPassword = await isCAPasswordCorrect(existingPasswd)
      if (validCAPassword) {
        await startNewEU(existingPasswd, euOrg, euCN)
      } else {
        log(err('The CA passphrase you entered is incorrect'))
      }
    } else {
      log(err('The CA passphrase you entered is incorrect'))
    }
  }
}

async function handleExistingCAWithPasswd (caCN, euCN, euOrg, pwCA, pwEU) {
  await startNewEU(pwCA, euOrg, euCN)
}

async function main () {
  const caExists = await checkCAExists()

  if (caExists) {
    const caCertDir = `${HOME_DATA}/ca/certs`
    const caCertFilePath = `${caCertDir}/ca.cert.pem`
    const euCertDir = `${HOME_DATA}/eu/certs`
    const euCertFilePath = `${euCertDir}/cert.pem`

    const euCertExists = await fileExists(euCertFilePath)

    const [caOrg, caCN] = await extractCNFromCert(caCertFilePath)

    const fallbackEuCN = caCN.replace('Certificate Authority', 'Web Client')
    const [euOrg, euCN] = euCertExists
      ? await extractCNFromCert(euCertFilePath)
      : [caOrg, fallbackEuCN]

    const caPassFile = `${HOME_DATA}/ca/passphrase.txt`
    const pwCA = await extractPassphraseFromFile(caPassFile)
    const euPassFile = `${HOME_DATA}/eu/passphrase.txt`
    const pwEU = await extractPassphraseFromFile(euPassFile)

    const validCAPassword = await isCAPasswordFromFileCorrect(caPassFile)
    if (validCAPassword) {
      await handleExistingCAWithPasswd(caCN, euCN, euOrg, pwCA, pwEU)
    } else {
      await handleExistingCANoPasswd(caCN, euCN, euOrg)
    }
  } else {
    await startFresh()
  }
}

main()
