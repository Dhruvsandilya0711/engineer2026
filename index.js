import express from 'express';
import {fileURLToPath} from 'url';
import {dirname} from 'path';
import path from 'path'

const __fileName = fileURLToPath(import.meta.url)
const __dirname = dirname(__fileName)

const app = express();
const port = 3000;

app.set('view engine', 'ejs');

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.render('index', {foo: 'FOO'});
});



app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});