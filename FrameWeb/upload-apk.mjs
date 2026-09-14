import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const url = 'https://viigaxgbimmjudbuhoqh.supabase.co';
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpaWdheGdiaW1tanVkYnVob3FoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Nzg2MzgwOCwiZXhwIjoyMTAzNDM5ODA4fQ.SmtmVawCS4EFZ7dGHKreNNsy1JaEg0bYurGlBl2mW_s";
const supabase = createClient(url, key);

async function main() {
  const apkData = fs.readFileSync('../Frame/android/app/build/outputs/apk/release/app-release.apk');
  console.log('Uploading frame-1.5.0.apk... size:', apkData.length);
  const { data, error } = await supabase.storage.from('app').upload('frame-1.5.0.apk', apkData, { upsert: true, contentType: 'application/vnd.android.package-archive' });
  if (error) {
    console.error('Error uploading:', error);
  } else {
    console.log('Upload success:', data);
  }
}
main();
