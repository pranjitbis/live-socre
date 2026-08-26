const fs = require('fs');
const path = require('path');

const dockerfile = path.join(__dirname, '..', 'Dockerfile');
const dockerignore = path.join(__dirname, '..', '.dockerignore');

if (fs.existsSync(dockerfile)) {
  fs.unlinkSync(dockerfile);
  console.log('✅ Deleted Dockerfile');
}

if (fs.existsSync(dockerignore)) {
  fs.unlinkSync(dockerignore);
  console.log('✅ Deleted .dockerignore');
}
