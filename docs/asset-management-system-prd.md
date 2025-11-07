# Asset Management System Product Requirements Document (PRD)

## Overview

The Asset Management System will allow administrators to create "Ashrams" (locations or entities) and assign multiple email IDs with appropriate permissions to manage the assets within each ashram. Users will be able to add, manage, and track assets like cars, electronics, and other equipment. All assets will be linked with essential documents, QR codes for scanning, and reminders for various processes such as insurance expiration, maintenance, etc.

Firebase will be used for authentication, database management, and real-time data syncing.

---

## 1. Users and Roles

### Admin

- Can create new ashrams.
- Assign permissions to different email IDs to manage specific ashrams (or multiple ashrams).
- View and manage all assets within the system.

### Ashram User

- Can manage assets only within assigned ashrams.
- Add or edit asset information for assets belonging to assigned ashrams.

### Head Office

- Can manage and view assets across all ashrams.
- View and query items based on categories or ashram location.
- Can approve or delete assets after archiving.

---

## 2. Core Features

### 2.1 Ashram Creation and Management

- Admin can create multiple ashrams.
- Each ashram has an assigned list of users (email IDs) who can access and manage assets.
- Permissions:
  - Admin can assign one or more users to manage assets within a specific ashram.
  - Users can be assigned multiple ashrams if needed (e.g., Head Office users).

### 2.2 Asset Addition

Authorized users can add assets (e.g., cars, electronics, office furniture, etc.) to ashrams. Each asset will include the following fields:

**Basic Information**

- Name of the asset.
- Category (Car, Electrical, Laptop, etc.).
- Asset tag/ID (auto-generated).
- Date of purchase.
- Current status (Active, Sold, Archived).
- Owner information.

**Category-Specific Information (examples)**

- **Car:**
  - Road tax certificate.
  - RC copy.
  - Insurance details (expiry date, provider, policy number).
  - Purchase invoice.
  - Vehicle details (make, model, registration).
  - Reminders for insurance expiry, tax renewal, etc.
- **Electrical Items (e.g., Refrigerator, Microwave):**
  - Invoice and warranty information.
  - Date of purchase.
  - Warranty period.
- **Laptops/Computers:**
  - Purchase invoice.
  - Warranty information.
  - Specifications (brand, model, serial number).
- **Others:**
  - Specific documents related to each asset (furniture, office equipment).

### 2.3 QR Code Generation

- After an asset is added, a **QR code** is automatically generated and linked to the asset.
- The QR code is to be physically attached to the item (via labels or stickers).
- When the QR code is scanned by authorized personnel, the relevant asset details (documents, status, ownership) will be displayed.

### 2.4 Asset Reminders

- Set automatic reminders for asset-related tasks (e.g., insurance expiry, road tax renewal).
- Reminders can be set up during asset creation or modified later.

### 2.5 Archiving and Deletion of Assets

- Once an asset is sold, it can be archived in the system for record-keeping.
- Admin and Head Office users can permanently delete assets after they have been archived for a specified time period.
- Archived items will not appear on regular dashboards but can be queried.

### 2.6 Dashboards

#### 2.6.1 Ashram Dashboard

- Displays assets belonging to the ashram.
- Filters for asset category (e.g., cars, laptops, electrical).
- A quick summary of asset counts (how many of each category) and reminders (e.g., how many assets have expiring insurance).
- Ability to add/edit assets if the user has the required permissions.

#### 2.6.2 Head Office Dashboard

- Displays assets across all ashrams.
- Query-based interface to filter and view assets by category, location, and status.
- Ability to track assets across ashrams (e.g., view all cars across all ashrams).

#### 2.6.3 Query Interface

For head office and admin roles to run queries:

- "Show me all cars across ashrams."
- "Show all assets with expiring insurance in the next month."
- "Show all laptops purchased in 2024."

---

## 3. Database Design (using Firebase)

- **Users Collection:** Stores user information, roles, and permissions (admin, ashram user, head office).
- **Ashrams Collection:** Contains all created ashrams, linked with the list of users (email IDs).
- **Assets Collection:** Contains all assets and their details (name, category, documents, QR code link, etc.). Each asset is linked to one or more ashrams.
- **Documents Collection:** Stores links to uploaded documents related to each asset (e.g., insurance documents, invoices).
- **QR Code Links Collection:** Contains generated QR codes for each asset and links to the asset details.
- **Reminders Collection:** Stores reminder settings (e.g., insurance expiration date) and alerts.

---

## 4. Firebase Authentication

- Users will log in using **Firebase Authentication** (email/password or Google login).
- Different roles will be assigned based on email IDs.
- Admins will have full access to all features, while ashram users will only have access to their assigned ashrams.

---

## 5. System Flow

### 5.1 Admin Flow

1. Admin logs in to the system.
2. Creates new ashrams and assigns permissions (email IDs).
3. Can add/edit assets, assign categories, and link documents to assets.
4. Admin can view all ashrams and assets across the system.

### 5.2 Ashram User Flow

1. Ashram user logs in.
2. They can view assets linked to their assigned ashram.
3. They can add new assets (following category-based document requirements) and attach the necessary files.
4. They will generate QR codes for new assets.

### 5.3 Head Office User Flow

1. Head Office user logs in.
2. They have access to all ashrams.
3. They can query, manage, and view assets across multiple ashrams.
4. Head Office can also archive or delete assets, approve new asset additions, and track reminders.

---

## 6. Technology Stack

- **Frontend:**
  - Firebase Studio for front-end development (UI/UX).
  - React or Vue.js for dynamic interfaces.
- **Backend:**
  - Firebase Firestore for real-time database and data storage.
  - Firebase Functions for processing QR codes and reminders.
  - Firebase Authentication for user management and role-based access.
- **QR Code Generation:**
  - Use a QR code generation library (e.g., `qrcode.react` for React).
  - The QR codes will be stored in Firebase Storage and linked to the assets.

---

## 7. Security and Privacy

- **Role-based Access Control (RBAC):** Each user will only have access to the ashrams and assets they are permitted to manage.
- **Data Encryption:** Firebase ensures end-to-end encryption for all data in transit and at rest.
- **Audit Logs:** Track who added or modified assets, with timestamps, for auditing purposes.

---

## 8. Additional Features (Future Scope)

- **Mobile App:** Develop mobile applications for Android and iOS for asset management on the go.
- **Advanced Reporting:** Generate reports on asset lifecycle, warranty status, or asset performance.

---

## Conclusion

This Asset Management System will improve the organization, tracking, and management of assets across multiple locations (ashrams). With QR codes, document tracking, role-based access, and real-time updates via Firebase, the system will streamline asset management and allow efficient decision-making.

