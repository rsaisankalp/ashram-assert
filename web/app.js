import * as firebaseModule from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  initializeFirestore,
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  runTransaction,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

const firebaseConfig = firebaseModule.firebaseConfig;
const configSuperAdmins = firebaseModule.defaultSuperAdmins ?? [];
const fallbackSuperAdmins = ['rsaisankalp@gmail.com'];
const DEFAULT_SUPER_ADMINS = Array.from(
  new Set(
    [...fallbackSuperAdmins, ...configSuperAdmins]
      .filter(Boolean)
      .map((email) => email.toLowerCase()),
  ),
);

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false,
});
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

const ui = {
  signInButton: document.getElementById('signInButton'),
  signOutButton: document.getElementById('signOutButton'),
  authStatus: document.getElementById('authStatus'),
  authIndicator: document.getElementById('authIndicator'),
  roleBadges: document.getElementById('roleBadges'),
  adminTools: document.getElementById('adminTools'),
  ashramBoard: document.getElementById('ashramBoard'),
  headOfficeBoard: document.getElementById('headOfficeBoard'),
  ashramSelect: document.getElementById('ashramSelect'),
  assignAshramSelect: document.getElementById('assignAshramSelect'),
  assetList: document.getElementById('assetList'),
  reminderList: document.getElementById('reminderList'),
  hoAshramBreakdown: document.getElementById('hoAshramBreakdown'),
  hoReminderList: document.getElementById('hoReminderList'),
  toast: document.getElementById('toast'),
  ashramTotalAssets: document.getElementById('ashramTotalAssets'),
  ashramReminderCount: document.getElementById('ashramReminderCount'),
  ashramTopCategory: document.getElementById('ashramTopCategory'),
  hoTotalAssets: document.getElementById('hoTotalAssets'),
  hoTotalAshrams: document.getElementById('hoTotalAshrams'),
  hoReminders: document.getElementById('hoReminders'),
};

const state = {
  authUser: null,
  profile: null,
  ashrams: [],
  ashramsById: new Map(),
  selectedAshramId: localStorage.getItem('selectedAshramId') ?? '',
  unsubAssets: null,
  assetDocs: [],
  deepLinkAssetId: new URLSearchParams(window.location.search).get('assetId'),
  filters: {
    category: 'ALL',
    status: 'ALL',
    search: '',
  },
};

const ASSET_STATUSES = ['ACTIVE', 'SOLD', 'ARCHIVED'];
const REMINDER_TYPES = ['INSURANCE', 'TAX', 'MAINTENANCE', 'WARRANTY', 'CUSTOM'];
const ASSET_CATEGORIES = ['CAR', 'ELECTRICAL', 'LAPTOP', 'FURNITURE', 'OTHER'];
const DOCUMENT_CATEGORIES = ['INVOICE', 'WARRANTY', 'RC', 'INSURANCE', 'PHOTO', 'OTHER'];
const uuid = () => (crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

ui.signInButton.addEventListener('click', () => signInWithPopup(auth, provider).catch(handleError));
ui.signOutButton.addEventListener('click', () => signOut(auth).catch(handleError));
ui.ashramSelect.addEventListener('change', (event) => selectAshram(event.target.value));
document.getElementById('closeAssetDetail').addEventListener('click', hideAssetDetail);
document.getElementById('assetDetailModal').addEventListener('click', (event) => {
  if (event.target.id === 'assetDetailModal') {
    hideAssetDetail();
  }
});
document.querySelectorAll('.tab-button').forEach((button) => {
  button.addEventListener('click', () => setActiveTab(button.dataset.tab));
});
setActiveTab('overview');
document.getElementById('assetSearch').addEventListener('input', (event) => {
  state.filters.search = event.target.value;
  renderAssetList();
});
document.getElementById('filterCategory').addEventListener('change', (event) => {
  state.filters.category = event.target.value;
  renderAssetList();
});
document.getElementById('filterStatus').addEventListener('change', (event) => {
  state.filters.status = event.target.value;
  renderAssetList();
});

document.getElementById('createAshramForm').addEventListener('submit', handleCreateAshram);
document.getElementById('assignUserForm').addEventListener('submit', handleAssignUser);
document.getElementById('assetForm').addEventListener('submit', handleAssetSubmit);

onAuthStateChanged(auth, async (user) => {
  state.authUser = user;
  if (!user) {
    state.profile = null;
    updateAuthUI(null);
    cleanupSubscriptions();
    return;
  }

  updateAuthUI('loading');
  try {
    state.profile = await ensureUserProfile(user);
    updateAuthUI(state.profile);
    await refreshAshrams();
    selectAshram(state.selectedAshramId || state.ashrams[0]?.id || '');
    if (hasHeadOfficeAccess()) {
      await loadHeadOfficeSnapshot();
    }
    await handleDeepLink();
  } catch (error) {
    handleError(error);
    ui.authStatus.textContent = 'Unable to load your profile. Check Firebase rules/config and refresh.';
    ui.authIndicator.classList.remove('online');
    ui.authIndicator.classList.add('offline');
    ui.adminTools.classList.add('hidden');
    ui.ashramBoard.classList.add('hidden');
    ui.headOfficeBoard.classList.add('hidden');
  }
});

function hasRole(role) {
  return state.profile?.roles?.includes(role);
}

function hasHeadOfficeAccess() {
  return hasRole('ADMIN') || hasRole('HEAD_OFFICE');
}

function ensureSuperAdminRoles(existingRoles = []) {
  const roles = new Set(existingRoles.length ? existingRoles : ['ASHRAM_USER']);
  let changed = false;
  ['ADMIN', 'HEAD_OFFICE'].forEach((role) => {
    if (!roles.has(role)) {
      roles.add(role);
      changed = true;
    }
  });
  return { roles: Array.from(roles), changed };
}

async function applyPendingInvites(userRef, profile) {
  const invitesSnap = await getDocs(
    query(
      collection(db, 'invites'),
      where('email', '==', profile.email),
      where('status', '==', 'PENDING'),
    ),
  );
  if (invitesSnap.empty) {
    return profile;
  }
  const updatedRoles = new Set(profile.roles ?? []);
  const updatedAshrams = new Set(profile.ashramIds ?? []);
  for (const inviteDoc of invitesSnap.docs) {
    const invite = inviteDoc.data();
    for (const role of invite.roles ?? []) {
      updatedRoles.add(role);
    }
    if (invite.ashramId) {
      updatedAshrams.add(invite.ashramId);
      await addUserToAshramMembers(invite.ashramId, profile.id);
    }
    await updateDoc(inviteDoc.ref, {
      status: 'FULFILLED',
      fulfilledAt: serverTimestamp(),
      fulfilledBy: profile.id,
    });
  }
  await updateDoc(userRef, {
    roles: Array.from(updatedRoles),
    ashramIds: Array.from(updatedAshrams),
    updatedAt: serverTimestamp(),
  });
  return { ...profile, roles: Array.from(updatedRoles), ashramIds: Array.from(updatedAshrams) };
}

async function addUserToAshramMembers(ashramId, userId) {
  const ashramRef = doc(db, 'ashrams', ashramId);
  const snap = await getDoc(ashramRef);
  if (!snap.exists()) return;
  const memberIds = new Set(snap.data().memberIds ?? []);
  if (!memberIds.has(userId)) {
    memberIds.add(userId);
    await updateDoc(ashramRef, {
      memberIds: Array.from(memberIds),
      updatedAt: serverTimestamp(),
    });
  }
}

function updateAuthUI(profile) {
  if (profile === null) {
    ui.authIndicator.classList.remove('online');
    ui.authIndicator.classList.add('offline');
    ui.authStatus.textContent = 'Sign in to load your assignments.';
    ui.signInButton.classList.remove('hidden');
    ui.signOutButton.classList.add('hidden');
    ui.roleBadges.innerHTML = '';
    ui.adminTools.classList.add('hidden');
    ui.ashramBoard.classList.add('hidden');
    ui.headOfficeBoard.classList.add('hidden');
    state.ashrams = [];
    state.ashramsById.clear();
    ui.ashramSelect.innerHTML = '<option value="">No ashrams available</option>';
    ui.assignAshramSelect.innerHTML = '<option value="">No ashrams available</option>';
    state.assetDocs = [];
    renderAssetList();
    renderReminders([]);
    renderAshramStats([]);
    renderHeadOfficeSummary([]);
    return;
  }

  if (profile === 'loading') {
    ui.authIndicator.classList.remove('online');
    ui.authIndicator.classList.add('offline');
    ui.authStatus.textContent = 'Loading profile...';
    return;
  }

  ui.authIndicator.classList.remove('offline');
  ui.authIndicator.classList.add('online');
  ui.authStatus.innerHTML = `
    Signed in as <strong>${profile.displayName || profile.email}</strong><br />
    ${profile.email}
  `;
  ui.signInButton.classList.add('hidden');
  ui.signOutButton.classList.remove('hidden');
  ui.roleBadges.innerHTML = '';
  (profile.roles ?? []).forEach((role) => {
    const badge = document.createElement('span');
    badge.className = 'role-badge';
    badge.textContent = role.replace('_', ' ');
    ui.roleBadges.appendChild(badge);
  });

  ui.ashramBoard.classList.remove('hidden');
  ui.adminTools.classList.toggle('hidden', !hasRole('ADMIN'));
  ui.headOfficeBoard.classList.toggle('hidden', !hasHeadOfficeAccess());
}

async function ensureUserProfile(user) {
  const normalizedEmail = (user.email ?? '').toLowerCase();
  const isSuperAdmin = DEFAULT_SUPER_ADMINS.includes(normalizedEmail);
  const userRef = doc(db, 'users', user.uid);
  const snapshot = await getDoc(userRef);
  if (snapshot.exists()) {
    const data = snapshot.data();
    if (isSuperAdmin) {
      const promotedRoles = ensureSuperAdminRoles(data.roles);
      if (promotedRoles.changed) {
        await updateDoc(userRef, {
          roles: promotedRoles.roles,
          updatedAt: serverTimestamp(),
        });
        return { id: user.uid, ...data, roles: promotedRoles.roles };
      }
    }
    const profile = { id: user.uid, ...data };
    return applyPendingInvites(userRef, profile);
  }

  const baseRoles = isSuperAdmin ? ['ADMIN', 'HEAD_OFFICE'] : ['ASHRAM_USER'];
  const profile = {
    displayName: user.displayName ?? user.email,
    email: normalizedEmail,
    roles: baseRoles,
    ashramIds: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(userRef, profile);
  return applyPendingInvites(userRef, { id: user.uid, ...profile });
}

async function refreshAshrams() {
  if (!state.profile) return;
  let snapshot;
  if (hasHeadOfficeAccess()) {
    snapshot = await getDocs(query(collection(db, 'ashrams'), orderBy('name')));
  } else {
    snapshot = await getDocs(
      query(collection(db, 'ashrams'), where('memberIds', 'array-contains', state.profile.id)),
    );
  }

  state.ashrams = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  state.ashramsById = new Map(state.ashrams.map((item) => [item.id, item]));
  populateAshramSelect(ui.ashramSelect, state.ashrams);
  populateAshramSelect(ui.assignAshramSelect, snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
}

function populateAshramSelect(selectElement, ashrams) {
  if (!selectElement) return;
  selectElement.innerHTML = '';
  if (!ashrams.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No ashrams available';
    selectElement.appendChild(option);
    return;
  }
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select an ashram...';
  selectElement.appendChild(placeholder);
  ashrams.forEach((ashram) => {
    const option = document.createElement('option');
    option.value = ashram.id;
    option.textContent = ashram.name;
    selectElement.appendChild(option);
  });
  if (selectElement === ui.ashramSelect && state.selectedAshramId) {
    selectElement.value = state.selectedAshramId;
  }
}

function selectAshram(ashramId) {
  state.selectedAshramId = ashramId;
  if (ashramId) {
    localStorage.setItem('selectedAshramId', ashramId);
  } else {
    localStorage.removeItem('selectedAshramId');
  }
  subscribeToAssets();
}

function cleanupSubscriptions() {
  if (state.unsubAssets) {
    state.unsubAssets();
    state.unsubAssets = null;
  }
}

function subscribeToAssets() {
  cleanupSubscriptions();
  if (!state.selectedAshramId) {
    ui.assetList.innerHTML = '<div class="empty-state"><p>Select an ashram to load assets.</p></div>';
    state.assetDocs = [];
    renderReminders([]);
    renderAshramStats([]);
    return;
  }

  const assetsQuery = query(
    collection(db, 'assets'),
    where('ashramId', '==', state.selectedAshramId),
    orderBy('createdAt', 'desc'),
  );

  state.unsubAssets = onSnapshot(
    assetsQuery,
    (snapshot) => {
      state.assetDocs = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      renderAssetList();
      renderReminders(state.assetDocs);
      renderAshramStats(state.assetDocs);
      if (hasHeadOfficeAccess()) {
        loadHeadOfficeSnapshot();
      }
    },
    handleError,
  );
}

async function handleCreateAshram(event) {
  event?.preventDefault?.();
  const form =
    event?.currentTarget ?? document.getElementById('createAshramForm') ?? event?.target?.closest?.('form');
  if (!form) {
    showToast('Ashram form is not available. Refresh the page and try again.', 'error');
    return;
  }
  const formData = new FormData(form);
  const name = formData.get('name')?.trim();
  if (!name) {
    showToast('Ashram name is required.', 'error');
    return;
  }

  try {
    await addDoc(collection(db, 'ashrams'), {
      name,
      location: formData.get('location')?.trim() || '',
      createdBy: state.profile.id,
      createdByName: state.profile.displayName ?? state.profile.email,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      memberIds: [],
      assetCounters: {},
    });
    form.reset();
    showToast('Ashram created.', 'success');
    await refreshAshrams();
  } catch (error) {
    handleError(error);
  }
}

async function handleAssignUser(event) {
  event?.preventDefault?.();
  const form =
    event?.currentTarget ?? document.getElementById('assignUserForm') ?? event?.target?.closest?.('form');
  if (!form) {
    showToast('Assignment form is not available. Refresh the page and try again.', 'error');
    return;
  }
  if (!hasRole('ADMIN')) {
    showToast('Only admins can assign users.', 'error');
    return;
  }

  const formData = new FormData(form);
  const email = formData.get('email')?.trim().toLowerCase();
  const ashramId = formData.get('ashramId');
  const role = formData.get('role');
  if (!email || !ashramId || !role) {
    showToast('Please complete all assignment fields.', 'error');
    return;
  }

  try {
    const usersSnap = await getDocs(
      query(collection(db, 'users'), where('email', '==', email), limit(1)),
    );
    if (usersSnap.empty) {
      await addDoc(collection(db, 'invites'), {
        email,
        ashramId,
        roles: [role],
        status: 'PENDING',
        createdAt: serverTimestamp(),
        createdBy: state.profile.id,
        createdByName: state.profile.displayName ?? state.profile.email,
      });
      showToast('Invitation created. Access will be granted after the user signs in.', 'success');
      form.reset();
      return;
    }
    const userDoc = usersSnap.docs[0];
    const userRef = doc(db, 'users', userDoc.id);
    const ashramRef = doc(db, 'ashrams', ashramId);
    const ashramSnap = await getDoc(ashramRef);
    if (!ashramSnap.exists()) {
      showToast('Ashram not found.', 'error');
      return;
    }

    const batch = writeBatch(db);
    const currentRoles = new Set(userDoc.data().roles ?? []);
    currentRoles.add(role);
    const currentAshrams = new Set(userDoc.data().ashramIds ?? []);
    currentAshrams.add(ashramId);

    const memberIds = new Set(ashramSnap.data().memberIds ?? []);
    memberIds.add(userDoc.id);

    batch.update(userRef, {
      roles: Array.from(currentRoles),
      ashramIds: Array.from(currentAshrams),
      updatedAt: serverTimestamp(),
    });
    batch.update(ashramRef, {
      memberIds: Array.from(memberIds),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    showToast(`Assigned ${email} to ${ashramSnap.data().name} as ${role}.`, 'success');
    form.reset();
    await refreshAshrams();
  } catch (error) {
    handleError(error);
  }
}

async function handleAssetSubmit(event) {
  event?.preventDefault?.();
  const form = event?.currentTarget ?? document.getElementById('assetForm') ?? event?.target?.closest?.('form');
  if (!form) {
    showToast('Asset form is unavailable. Refresh and try again.', 'error');
    return;
  }
  if (!state.selectedAshramId) {
    showToast('Select an ashram before adding assets.', 'error');
    return;
  }

  const formData = new FormData(form);
  const payload = {
    name: formData.get('name')?.trim(),
    category: formData.get('category'),
    status: formData.get('status'),
    purchaseDate: formData.get('purchaseDate'),
    owner: formData.get('owner')?.trim(),
    notes: formData.get('notes')?.trim(),
    docName: formData.get('docName')?.trim(),
    docUrl: formData.get('docUrl')?.trim(),
    docCategory: formData.get('docCategory'),
    reminderType: formData.get('reminderType'),
    reminderDue: formData.get('reminderDue'),
    reminderNotes: formData.get('reminderNotes')?.trim(),
  };
  const docFile = form.querySelector('input[name="docFile"]')?.files?.[0];

  if (!payload.name || !payload.purchaseDate) {
    showToast('Asset name and purchase date are required.', 'error');
    return;
  }

  try {
    let uploadedDocument = null;
    if (docFile && docFile.size > 0) {
      showToast('Uploading document...', 'info');
      uploadedDocument = await uploadDocumentFile(docFile, { ashramId: state.selectedAshramId });
    }

    await runTransaction(db, async (txn) => {
      const ashramRef = doc(db, 'ashrams', state.selectedAshramId);
      const ashramSnap = await txn.get(ashramRef);
      if (!ashramSnap.exists()) {
        throw new Error('Ashram not found.');
      }
      const ashram = ashramSnap.data();
      const assetRef = doc(collection(db, 'assets'));
      const counters = { ...(ashram.assetCounters ?? {}) };
      const nextCount = (counters[payload.category] ?? 0) + 1;
      counters[payload.category] = nextCount;
      const assetTag = buildAssetTag(ashram.name, payload.category, nextCount);
      const qrPayload = buildQrPayload({
        ashram,
        asset: {
          id: assetRef.id,
          assetTag,
          name: payload.name,
          category: payload.category,
          status: payload.status,
          owner: payload.owner || '',
          purchaseDate: payload.purchaseDate,
          notes: payload.notes || '',
        },
      });
      const qrCode = buildQrImageUrl(qrPayload);

      const reminder =
        payload.reminderType && payload.reminderDue
          ? [
              {
                id: uuid(),
                type: payload.reminderType,
                dueDate: new Date(payload.reminderDue),
                notes: payload.reminderNotes || '',
                completed: false,
                createdAt: serverTimestamp(),
              },
            ]
          : [];

      const documents = [];
      if (payload.docName && payload.docUrl) {
        documents.push({
          id: uuid(),
          name: payload.docName,
          url: payload.docUrl,
          category: payload.docCategory ?? 'OTHER',
          uploadedAt: new Date(),
        });
      }
      if (uploadedDocument) {
        documents.push({
          id: uuid(),
          name: payload.docName || uploadedDocument.fileName,
          url: uploadedDocument.url,
          storagePath: uploadedDocument.storagePath,
          provider: 'B2',
          category: payload.docCategory ?? 'OTHER',
          uploadedAt: new Date(),
          metadata: {
            bucketId: uploadedDocument.bucketId,
            size: uploadedDocument.size,
            contentType: uploadedDocument.contentType,
          },
        });
      }

      txn.set(assetRef, {
        ashramId: state.selectedAshramId,
        ashramName: ashram.name,
        name: payload.name,
        category: payload.category,
        status: payload.status,
        purchaseDate: new Date(payload.purchaseDate),
        owner: payload.owner || '',
        metadata: payload.notes ? { notes: payload.notes } : {},
        documents,
        reminders: reminder,
        assetTag,
        assetCountersCategoryIndex: nextCount,
        qrCode,
        qrPayload,
        createdBy: state.profile.id,
        createdByName: state.profile.displayName ?? state.profile.email,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      txn.update(ashramRef, { assetCounters: counters, updatedAt: serverTimestamp() });
    });
    form.reset();
    showToast('Asset added successfully.', 'success');
  } catch (error) {
    handleError(error);
  }
}

function buildAssetTag(ashramName, category, counter) {
  const normalizedAshram = (ashramName || 'ASHR')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4) || 'ASHR';
  const normalizedCategory = category.toUpperCase().slice(0, 3);
  return `${normalizedAshram}-${normalizedCategory}-${String(counter).padStart(4, '0')}`;
}

function buildQrPayload({ ashram, asset }) {
  if (!asset?.id) {
    return JSON.stringify({
      assetTag: asset.assetTag,
      ashramName: ashram?.name,
    });
  }
  return buildAssetDetailLink(asset.id);
}

function buildQrImageUrl(payload) {
  const data = encodeURIComponent(JSON.stringify(payload));
  return `https://image-charts.com/chart?chs=320x320&cht=qr&choe=UTF-8&chl=${data}`;
}

function buildAssetDetailLink(assetId) {
  const base = new URL(window.location.origin + window.location.pathname);
  base.searchParams.set('assetId', assetId);
  return base.toString();
}

function renderQrBlock(asset) {
  if (!asset?.id) return '';
  const ashram = state.ashramsById.get(asset.ashramId);
  const qrUrl = buildQrImageUrl(buildQrPayload({ ashram, asset }));
  return `
    <div class="qr-block">
      <img src="${qrUrl}" alt="QR code for ${asset.name}" />
      <div class="qr-actions">
        <button data-action="download-qr" data-asset="${asset.id}">Download QR</button>
      </div>
    </div>
  `;
}

async function uploadDocumentFile(file, { ashramId }) {
  const response = await fetch('/api/upload', {
    method: 'POST',
    headers: {
      'X-File-Name': encodeURIComponent(file.name),
      'X-File-Type': file.type || 'application/octet-stream',
      'X-Ashram-Id': ashramId || 'unassigned',
    },
    body: file,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? 'Document upload failed. Check Backblaze configuration.');
  }
  return payload;
}

function getFilteredAssets() {
  const { category, status, search } = state.filters;
  const query = search.trim().toLowerCase();
  return state.assetDocs.filter((asset) => {
    if (category !== 'ALL' && asset.category !== category) return false;
    if (status !== 'ALL' && asset.status !== status) return false;
    if (query) {
      const haystack = `${asset.name} ${asset.assetTag} ${asset.owner ?? ''}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

function renderAssetList() {
  const container = ui.assetList;
  container.innerHTML = '';
  if (!state.selectedAshramId) {
    renderAshramStats([]);
    container.classList.add('empty-state');
    container.innerHTML = '<p>Select an ashram to load assets.</p>';
    return;
  }
  const assets = getFilteredAssets();
  renderAshramStats(assets);
  if (!assets.length) {
    container.classList.add('empty-state');
    container.innerHTML = '<p>No assets match the selected filters.</p>';
    return;
  }
  container.classList.remove('empty-state');
  assets.forEach((asset) => {
    const card = document.createElement('article');
    card.className = 'asset-card';
    const remindersDue = (asset.reminders ?? []).filter((reminder) => !reminder.completed);
    const documents = renderDocumentList(asset.documents ?? []);
    const qrBlock = renderQrBlock(asset);
    card.innerHTML = `
      <header>
        <h4>${asset.name}</h4>
        <span class="chip status ${asset.status}">${asset.status}</span>
      </header>
      <div class="asset-meta">
        <span class="chip category">${asset.category}</span>
        <span>${asset.assetTag}</span>
        <span>${formatDate(asset.purchaseDate)}</span>
        <span>${asset.owner || 'Unassigned'}</span>
      </div>
      ${qrBlock}
      <p>${asset.metadata?.notes || ''}</p>
      ${documents}
      <div class="asset-actions">
        <button data-action="print-qr" data-asset="${asset.id}">Print QR</button>
        ${
          remindersDue.length
            ? `<button data-action="complete-reminder" data-asset="${asset.id}" data-reminder="${remindersDue[0].id}">Mark Reminder Done</button>`
            : ''
        }
        <button data-action="attach-doc" data-asset="${asset.id}">Attach Document</button>
        <button data-action="view-detail" data-asset="${asset.id}">View Details</button>
      </div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll('button[data-action="print-qr"]').forEach((button) => {
    button.addEventListener('click', () => openQrModal(button.dataset.asset));
  });
  container.querySelectorAll('button[data-action="download-qr"]').forEach((button) => {
    button.addEventListener('click', () => downloadQrImage(button.dataset.asset));
  });
  container.querySelectorAll('button[data-action="complete-reminder"]').forEach((button) => {
    button.addEventListener('click', () =>
      markReminderComplete(button.dataset.asset, button.dataset.reminder),
    );
  });
  container.querySelectorAll('button[data-action="attach-doc"]').forEach((button) => {
    button.addEventListener('click', () => attachDocumentFlow(button.dataset.asset));
  });
  container.querySelectorAll('button[data-action="view-detail"]').forEach((button) => {
    button.addEventListener('click', () => {
      const asset = state.assetDocs.find((item) => item.id === button.dataset.asset);
      if (asset) showAssetDetail(asset);
    });
  });
}

function renderReminders(assets) {
  const reminders = [];
  const cutoff = Date.now() + 30 * 24 * 60 * 60 * 1000;
  assets.forEach((asset) => {
    (asset.reminders ?? []).forEach((reminder) => {
      const dueDate = toDate(reminder.dueDate)?.getTime();
      if (!reminder.completed && dueDate && dueDate <= cutoff) {
        reminders.push({
          assetId: asset.id,
          assetName: asset.name,
          assetTag: asset.assetTag,
          ...reminder,
        });
      }
    });
  });
  reminders.sort((a, b) => toDate(a.dueDate) - toDate(b.dueDate));

  const container = ui.reminderList;
  container.innerHTML = '';
  if (!reminders.length) {
    container.classList.add('empty-state');
    container.innerHTML = '<p>No reminders due in the next 30 days.</p>';
    ui.ashramReminderCount.textContent = '0';
    return;
  }
  container.classList.remove('empty-state');
  reminders.forEach((reminder) => {
    const card = document.createElement('article');
    card.className = 'reminder-card';
    card.innerHTML = `
      <strong>${reminder.type}</strong>
      <p>${reminder.assetName} • ${reminder.assetTag}</p>
      <p>Due ${formatDate(reminder.dueDate)}</p>
      <small>${reminder.notes || ''}</small>
    `;
    container.appendChild(card);
  });
  ui.ashramReminderCount.textContent = String(reminders.length);
}

function renderAshramStats(assets) {
  ui.ashramTotalAssets.textContent = String(assets.length ?? 0);
  if (!assets.length) {
    ui.ashramTopCategory.textContent = '–';
    return;
  }
  const counts = assets.reduce((acc, asset) => {
    const key = asset.category;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const [topCategory] =
    Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([category]) => category) ?? [];
  ui.ashramTopCategory.textContent = topCategory ?? '–';
}

function renderDocumentList(documents) {
  if (!documents.length) {
    return '';
  }
  const grouped = documents.reduce((acc, doc) => {
    const category = doc.category ?? 'OTHER';
    if (!acc.has(category)) acc.set(category, []);
    acc.get(category).push(doc);
    return acc;
  }, new Map());
  const sections = Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, docs]) => {
      const items = docs
        .map((doc) => {
          const name = doc.name || doc.storagePath || 'Document';
          const providerLabel = doc.provider ? ` <small>(${doc.provider})</small>` : '';
          const isManaged = doc.provider === 'B2' && doc.storagePath;
          const url = isManaged
            ? `/api/download?path=${encodeURIComponent(doc.storagePath)}`
            : doc.url;
          const metaParts = [];
          if (doc.metadata?.contentType) metaParts.push(doc.metadata.contentType);
          if (doc.metadata?.size) {
            const kb = (doc.metadata.size / 1024).toFixed(1);
            metaParts.push(`${kb} KB`);
          }
          const meta = metaParts.length ? ` <small>${metaParts.join(' • ')}</small>` : '';
          const content = url
            ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${name}</a>`
            : name;
          return `<li>${content}${providerLabel}${meta}</li>`;
        })
        .join('');
      return `<div class="document-group"><h4>${category}</h4><ul>${items}</ul></div>`;
    })
    .join('');
  return `<div class="document-list"><strong>Documents</strong>${sections}</div>`;
}

async function openQrModal(assetId) {
  const asset = state.assetDocs.find((item) => item.id === assetId);
  if (!asset) {
    showToast('QR code not available for this asset.', 'error');
    return;
  }
  const ashram = state.ashramsById.get(asset.ashramId);
  const qrUrl = buildQrImageUrl(buildQrPayload({ ashram, asset }));
  const qrWindow = window.open('', '_blank', 'width=360,height=520');
  if (!qrWindow) {
    showToast('Allow pop-ups to preview the QR code.', 'error');
    return;
  }
  qrWindow.document.write(`
    <title>${asset.assetTag} QR</title>
    <style>
      body{font-family:system-ui;padding:1rem;text-align:center;}
      img{width:320px;height:320px;margin:1rem auto;display:block;}
      h2{margin:0;}
    </style>
    <h2>${asset.name}</h2>
    <p>${asset.assetTag}</p>
    <img src="${qrUrl}" alt="QR Code for ${asset.name}" />
    <p>Scan to view summary for ${asset.assetTag}</p>
    <script>window.print()</script>
  `);
}

async function downloadQrImage(assetId) {
  const asset = state.assetDocs.find((item) => item.id === assetId);
  if (!asset) {
    showToast('Asset not found. Refresh and try again.', 'error');
    return;
  }
  try {
    const ashram = state.ashramsById.get(asset.ashramId);
    const qrUrl = buildQrImageUrl(buildQrPayload({ ashram, asset }));
    const response = await fetch(qrUrl);
    if (!response.ok) {
      throw new Error('Unable to download QR image. Check network connection.');
    }
    const blob = await response.blob();
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = `${asset.assetTag}-qr.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (error) {
    handleError(error);
  }
}

async function markReminderComplete(assetId, reminderId) {
  try {
    const asset = state.assetDocs.find((item) => item.id === assetId);
    if (!asset) {
      throw new Error('Asset not found.');
    }
    const reminders = (asset.reminders ?? []).map((reminder) =>
      reminder.id === reminderId
        ? { ...reminder, completed: true, completedAt: serverTimestamp() }
        : reminder,
    );
    await updateDoc(doc(db, 'assets', assetId), {
      reminders,
      updatedAt: serverTimestamp(),
    });
    showToast('Reminder marked complete.', 'success');
  } catch (error) {
    handleError(error);
  }
}

async function loadHeadOfficeSnapshot() {
  if (!hasHeadOfficeAccess()) return;
  try {
    const snapshot = await getDocs(collection(db, 'assets'));
    const assets = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    renderHeadOfficeSummary(assets);
  } catch (error) {
    handleError(error);
  }
}

function renderHeadOfficeSummary(assets) {
  if (!hasHeadOfficeAccess()) return;
  ui.hoTotalAssets.textContent = String(assets.length);
  const breakdown = assets.reduce((acc, asset) => {
    const key = asset.ashramId;
    if (!acc[key]) {
      acc[key] = { count: 0, name: asset.ashramName ?? asset.ashramId };
    }
    acc[key].count += 1;
    return acc;
  }, {});
  const entries = Object.entries(breakdown)
    .map(([ashramId, data]) => ({ ashramId, ...data }))
    .sort((a, b) => b.count - a.count);
  ui.hoTotalAshrams.textContent = String(entries.length);
  ui.hoAshramBreakdown.innerHTML = '';
  if (!entries.length) {
    ui.hoAshramBreakdown.classList.add('empty-state');
    ui.hoAshramBreakdown.innerHTML = '<p>No assets recorded.</p>';
  } else {
    ui.hoAshramBreakdown.classList.remove('empty-state');
    entries.forEach((entry) => {
      const card = document.createElement('article');
      card.className = 'breakdown-card';
      card.innerHTML = `<strong>${entry.name}</strong><p>${entry.count} assets</p>`;
      ui.hoAshramBreakdown.appendChild(card);
    });
  }

  const reminders = [];
  const cutoff = Date.now() + 30 * 24 * 60 * 60 * 1000;
  assets.forEach((asset) => {
    (asset.reminders ?? []).forEach((reminder) => {
      const dueDate = toDate(reminder.dueDate)?.getTime();
      if (!reminder.completed && dueDate && dueDate <= cutoff) {
        reminders.push({
          assetName: asset.name,
          ashramName: asset.ashramName ?? asset.ashramId,
          ...reminder,
        });
      }
    });
  });
  reminders.sort((a, b) => toDate(a.dueDate) - toDate(b.dueDate));
  ui.hoReminders.textContent = String(reminders.length);
  ui.hoReminderList.innerHTML = '';
  if (!reminders.length) {
    ui.hoReminderList.classList.add('empty-state');
    ui.hoReminderList.innerHTML = '<p>No reminders due.</p>';
  } else {
    ui.hoReminderList.classList.remove('empty-state');
    reminders.forEach((reminder) => {
      const card = document.createElement('article');
      card.className = 'reminder-card';
      card.innerHTML = `
        <strong>${reminder.type}</strong>
        <p>${reminder.assetName} (${reminder.ashramName})</p>
        <p>Due ${formatDate(reminder.dueDate)}</p>
        <small>${reminder.notes || ''}</small>
      `;
      ui.hoReminderList.appendChild(card);
    });
  }
}

function toDate(value) {
  if (!value) return null;
  if (value.toDate instanceof Function) {
    return value.toDate();
  }
  return new Date(value);
}

function formatDate(value) {
  const date = toDate(value);
  if (!date || Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(date);
}

function showToast(message, variant = 'info') {
  ui.toast.textContent = message;
  ui.toast.className = `toast ${variant === 'error' ? 'error' : variant === 'success' ? 'success' : ''}`;
  ui.toast.classList.remove('hidden');
  setTimeout(() => ui.toast.classList.add('hidden'), 3500);
}

function handleError(error) {
  console.error(error);
  const message = error?.message ?? 'Unexpected error. Check console for details.';
  showToast(message, 'error');
}

async function handleDeepLink() {
  if (!state.deepLinkAssetId || !state.profile) return;
  try {
    const assetRef = doc(db, 'assets', state.deepLinkAssetId);
    const snap = await getDoc(assetRef);
    if (!snap.exists()) {
      showToast('Asset not found for this QR link.', 'error');
      clearDeepLink();
      return;
    }
    const asset = { id: snap.id, ...snap.data() };
    if (!canViewAsset(asset)) {
      showToast('You do not have access to this asset.', 'error');
      clearDeepLink();
      return;
    }
    showAssetDetail(asset);
  } catch (error) {
    handleError(error);
  } finally {
    clearDeepLink();
  }
}

function canViewAsset(asset) {
  if (hasHeadOfficeAccess()) return true;
  return state.profile?.ashramIds?.includes(asset.ashramId);
}

function clearDeepLink() {
  state.deepLinkAssetId = null;
  const base = window.location.origin + window.location.pathname;
  window.history.replaceState({}, document.title, base);
}

function showAssetDetail(asset) {
  const modal = document.getElementById('assetDetailModal');
  const body = document.getElementById('assetDetailBody');
  const ashram = state.ashramsById.get(asset.ashramId);
  const qrLink = buildAssetDetailLink(asset.id);
  const qrImg = buildQrImageUrl(qrLink);
  body.innerHTML = `
    <h2>${asset.name}</h2>
    <p><strong>Asset Tag:</strong> ${asset.assetTag}</p>
    <p><strong>Ashram:</strong> ${ashram?.name ?? asset.ashramId}</p>
    <p><strong>Category:</strong> ${asset.category}</p>
    <p><strong>Status:</strong> ${asset.status}</p>
    <p><strong>Owner:</strong> ${asset.owner || 'Unassigned'}</p>
    <p><strong>Purchase Date:</strong> ${formatDate(asset.purchaseDate)}</p>
    <p><strong>Notes:</strong> ${asset.metadata?.notes || '—'}</p>
    <div class="qr-block">
      <img src="${qrImg}" alt="QR code for ${asset.name}" />
      <div class="qr-actions">
        <button data-action="download-qr-detail" data-asset="${asset.id}">Download QR</button>
        <button data-action="print-qr-detail" data-asset="${asset.id}">Print QR</button>
      </div>
    </div>
    ${renderDocumentList(asset.documents ?? [])}
  `;
  modal.classList.remove('hidden');
  body
    .querySelector('button[data-action="download-qr-detail"]')
    .addEventListener('click', () => downloadQrImage(asset.id));
  body
    .querySelector('button[data-action="print-qr-detail"]')
    .addEventListener('click', () => openQrModal(asset.id));
}

function hideAssetDetail() {
  document.getElementById('assetDetailModal').classList.add('hidden');
}

function setActiveTab(tab) {
  document.querySelectorAll('.tab-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.panel === tab);
  });
}

async function attachDocumentFlow(assetId) {
  const asset = state.assetDocs.find((item) => item.id === assetId);
  if (!asset) {
    showToast('Asset not found. Refresh and try again.', 'error');
    return;
  }
  const file = await pickSingleFile();
  if (!file) {
    showToast('Upload cancelled.', 'info');
    return;
  }
  const defaultName = file.name ?? `${asset.name} document`;
  const name = prompt('Document name', defaultName);
  if (name === null) {
    showToast('Upload cancelled.', 'info');
    return;
  }
  const categoryInput = prompt(
    'Document category (INSURANCE, RC, INVOICE, WARRANTY, PHOTO, OTHER)',
    'OTHER',
  );
  const category = normalizeDocumentCategory(categoryInput);
  try {
    showToast('Uploading document...', 'info');
    const uploaded = await uploadDocumentFile(file, { ashramId: asset.ashramId });
    const newDoc = {
      id: uuid(),
      name: (name ?? defaultName).trim() || defaultName,
      url: uploaded.url,
      storagePath: uploaded.storagePath,
      provider: 'B2',
      category,
      uploadedAt: new Date(),
      metadata: {
        bucketId: uploaded.bucketId,
        size: uploaded.size,
        contentType: uploaded.contentType,
      },
    };
    const documents = [...(asset.documents ?? []), newDoc];
    await updateDoc(doc(db, 'assets', asset.id), {
      documents,
      updatedAt: serverTimestamp(),
    });
    showToast('Document attached.', 'success');
  } catch (error) {
    handleError(error);
  }
}

function pickSingleFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt';
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
    };
    input.click();
  });
}

function normalizeDocumentCategory(value) {
  const upper = (value ?? 'OTHER').toString().trim().toUpperCase();
  return DOCUMENT_CATEGORIES.includes(upper) ? upper : 'OTHER';
}
