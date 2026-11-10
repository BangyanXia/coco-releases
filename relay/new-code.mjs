import {randomBytes} from 'node:crypto';
import {codeHash} from './worker.mjs';
const code='coco_'+randomBytes(24).toString('base64url');
console.log('仅交给受邀用户：',code,'\n加入 COCO_CODE_HASHES 的摘要：',await codeHash(code));
