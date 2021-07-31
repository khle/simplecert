const https = require('https')
const fs = require('fs')

const options = {
  //key: fs.readFileSync('output/eu/private/key.pem'),
  //cert: fs.readFileSync('output/eu/certs/cert.pem'),
  pfx: fs.readFileSync('output/eu/certs/cert.p12'),
  passphrase: 'foobar'
}

https
  .createServer(options, function (req, res) {
    res.writeHead(200)
    res.end('simplecert example')
  })
  .listen(8000)
