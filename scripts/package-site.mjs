import {access,copyFile,mkdir} from 'node:fs/promises';
import {siteFiles} from './site-files.mjs';
const root = new URL('../',import.meta.url);
const output = new URL('dist/',root);
await Promise.all(siteFiles.map(name=>access(new URL(name,root))));
await mkdir(output,{recursive:true});
await Promise.all(siteFiles.map(name=>copyFile(new URL(name,root),new URL(name,output))));
console.log(`GitHub Pages: ${siteFiles.length} public files packaged in dist`);
