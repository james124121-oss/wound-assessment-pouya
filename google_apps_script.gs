
function doGet(e) {
  try {
    const action = String((e.parameter && e.parameter.action) || '');
    if (action === 'searchPatient') {
      return searchPatient_(e);
    }
    if (action === 'getImage') {
      return getImage_(e);
    }
    return json_({ok:true, service:'WoundMeasure AI backend'});
  } catch (err) {
    return json_({ok:false, error:String(err && err.message ? err.message : err)});
  }
}

function searchPatient_(e) {
  const key = safeName((e.parameter && e.parameter.key) || '');
  const rootName = safeName((e.parameter && e.parameter.root) || 'WoundMeasure');
  if (!key) return json_({ok:false,error:'Missing patient key'});

  const roots = DriveApp.getRootFolder().getFoldersByName(rootName);
  if (!roots.hasNext()) return json_({ok:true,found:false});
  const root = roots.next();

  // Search one level down (hospital folders), then patient folders.
  const hospitals = root.getFolders();
  while (hospitals.hasNext()) {
    const hospital = hospitals.next();
    const patients = hospital.getFolders();
    while (patients.hasNext()) {
      const pf = patients.next();
      if (pf.getName() === key) {
        return patientFolderPayload_(pf);
      }
    }
  }

  // Fallback: inspect assessment JSON files for matching MRN or Patient ID.
  const hospitals2 = root.getFolders();
  while (hospitals2.hasNext()) {
    const hospital = hospitals2.next();
    const patients = hospital.getFolders();
    while (patients.hasNext()) {
      const pf = patients.next();
      const files = pf.getFiles();
      while (files.hasNext()) {
        const f = files.next();
        if (f.getName().indexOf('assessment_') !== 0 || !f.getName().endsWith('.json')) continue;
        try {
          const d = JSON.parse(f.getBlob().getDataAsString());
          const mrn = String(get_(d,'patient.mrn') || '');
          const pid = String(get_(d,'patient.patient_id') || '');
          if (mrn === key || pid === key) {
            return patientFolderPayload_(pf);
          }
        } catch (ignore) {}
      }
    }
  }

  return json_({ok:true,found:false});
}

function patientFolderPayload_(pf) {
  const assessments = [];
  let patient = {};
  const files = pf.getFiles();
  const photos = [];

  while (files.hasNext()) {
    const f = files.next();
    const name = f.getName();

    if (name.indexOf('assessment_') === 0 && name.endsWith('.json')) {
      try {
        const d = JSON.parse(f.getBlob().getDataAsString());
        d._file_name = name;
        d._file_date = f.getDateCreated().toISOString();
        assessments.push(d);
        if ((!patient || !patient.mrn) && d.patient) patient = d.patient;
      } catch (ignore) {}
    }

    if (/^(baseline|followup)_.*\.(jpg|jpeg|png)$/i.test(name)) {
      photos.push({
        id:f.getId(),
        name:name,
        created:f.getDateCreated().getTime()
      });
    }
  }

  assessments.sort(function(a,b){
    return String(b.exported_at || b._file_date || '').localeCompare(String(a.exported_at || a._file_date || ''));
  });
  photos.sort(function(a,b){return b.created-a.created;});

  // Return a direct Apps Script proxy URL instead of a Drive sharing URL.
  // The image remains accessed through this web app.
  if (photos.length) {
    const scriptUrl = ScriptApp.getService().getUrl();
    const latestUrl = scriptUrl + '?action=getImage&fileId=' + encodeURIComponent(photos[0].id);
    assessments.forEach(function(a){ if (!a.latest_photo_url) a.latest_photo_url = latestUrl; });
  }

  return json_({
    ok:true,
    found:true,
    patient:patient || {},
    assessments:assessments
  });
}

function getImage_(e) {
  const id = String((e.parameter && e.parameter.fileId) || '');
  if (!id) return ContentService.createTextOutput('Missing fileId');
  const f = DriveApp.getFileById(id);
  const blob = f.getBlob();
  // ContentService cannot directly return arbitrary binary responses,
  // so return a data URL JSON object for browser use.
  const dataUrl = 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
  return json_({ok:true,data_url:dataUrl,name:f.getName()});
}


/**
 * WoundMeasure AI — Google Apps Script backend
 *
 * Deploy as:
 * Deploy > New deployment > Web app
 * Execute as: Me
 * Who has access: choose the narrowest option that works for your organization.
 *
 * IMPORTANT:
 * This is an MVP example. For real clinical deployment, add authentication,
 * authorization, audit logging, retention rules and institutional privacy controls.
 */

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || '{}');
    const rootName = safeName(data.drive_root_folder || 'WoundMeasure');

    const root = getOrCreateFolder_(DriveApp.getRootFolder(), rootName);
    const hospital = getOrCreateFolder_(root, safeName((data.patient && data.patient.hospital) || 'Hospital_Unspecified'));
    const mrn = safeName((data.patient && (data.patient.mrn || data.patient.patient_id)) || ('Patient_' + Date.now()));
    const patientFolder = getOrCreateFolder_(hospital, mrn);

    // Save structured JSON snapshot
    const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm-ss');
    patientFolder.createFile('assessment_' + stamp + '.json', JSON.stringify(data, null, 2), MimeType.PLAIN_TEXT);

    // Save images
    if (data.images && data.images.baseline) saveDataUrl_(patientFolder, data.images.baseline, 'baseline_' + stamp + '.jpg');
    if (data.images && data.images.followup) saveDataUrl_(patientFolder, data.images.followup, 'followup_' + stamp + '.jpg');

    // Append one row to a master spreadsheet in root folder
    const sheet = getOrCreateMasterSheet_(root);
    sheet.appendRow([
      new Date(),
      get_(data,'patient.patient_id'), get_(data,'patient.first_name'), get_(data,'patient.last_name'),
      get_(data,'patient.mrn'), get_(data,'patient.hospital'),
      get_(data,'wound.location'), get_(data,'wound.type'),
      get_(data,'baseline.date'), get_(data,'baseline.wound_area_cm2'),
      get_(data,'followup.date'), get_(data,'followup.wound_area_cm2'),
      get_(data,'followup.granulation_area_cm2'), get_(data,'followup.granulation_percent'),
      get_(data,'comparison.wound_area_reduction_percent'),
      get_(data,'burn.tbsa_percent'), get_(data,'burn.partial_thickness_tbsa'), get_(data,'burn.full_thickness_tbsa')
    ]);

    return json_({ok:true, folder_id:patientFolder.getId(), folder_url:patientFolder.getUrl()});
  } catch (err) {
    return json_({ok:false, error:String(err && err.message ? err.message : err)});
  }
}

function getOrCreateFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function saveDataUrl_(folder, dataUrl, filename) {
  const m = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!m) return;
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], filename);
  folder.createFile(blob);
}

function getOrCreateMasterSheet_(rootFolder) {
  const files = rootFolder.getFilesByName('WoundMeasure_Master');
  let ss;
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
  } else {
    ss = SpreadsheetApp.create('WoundMeasure_Master');
    const file = DriveApp.getFileById(ss.getId());
    rootFolder.addFile(file);
    DriveApp.getRootFolder().removeFile(file);
    ss.getSheets()[0].appendRow([
      'Saved At','Patient ID','First Name','Last Name','MRN','Hospital',
      'Wound Location','Wound Type','Baseline Date','Baseline Area cm2',
      'Follow-up Date','Follow-up Area cm2','Granulation Area cm2','Granulation %',
      'Area Reduction %','TBSA %','Partial TBSA %','Full TBSA %'
    ]);
  }
  return ss.getSheets()[0];
}

function get_(obj, path) {
  return path.split('.').reduce((v,k)=>v && v[k] !== undefined ? v[k] : '', obj);
}

function safeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|#%{}]/g,'_').trim().slice(0,120) || 'Unnamed';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
