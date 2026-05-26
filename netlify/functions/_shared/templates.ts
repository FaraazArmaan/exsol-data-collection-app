// netlify/functions/_shared/templates.ts

export type ColumnType = 'text' | 'date' | 'integer' | 'boolean';

export interface ColumnDef {
  key: string;                  // snake_case → DB column name (strict validator)
  label: string;                // UI label
  type: ColumnType;
  required: boolean;
  default?: string | number | boolean;
  display_in_list?: boolean;    // true → shown in bucket panel list view
  help?: string;                // optional tooltip
}

export type Cardinality = 'singleton' | 'multi';

export interface RoleDef {
  key: string;                  // snake_case → table name (strict validator)
  label: string;                // UI label
  cardinality: Cardinality;
  columns: ColumnDef[];         // additive to shared core (never replaces)
}

export interface TemplateDef {
  key: string;
  label: string;
  version: number;
  roles: RoleDef[];             // order matters — bucket panels render in this order
}

export const TEMPLATES: Record<string, TemplateDef> = {
  shop: {
    key: 'shop',
    label: 'Shop',
    version: 1,
    roles: [
      { key: 'owners', label: 'Owner', cardinality: 'singleton', columns: [] },
      {
        key: 'employees', label: 'Employee', cardinality: 'multi', columns: [
          { key: 'position', label: 'Position', type: 'text', required: true, display_in_list: true },
          { key: 'hire_date', label: 'Hire date', type: 'date', required: false },
          { key: 'active', label: 'Active', type: 'boolean', required: true, display_in_list: true, default: true },
        ],
      },
      { key: 'customers', label: 'Customer', cardinality: 'multi', columns: [] },
    ],
  },

  store: {
    key: 'store',
    label: 'Store',
    version: 1,
    roles: [
      { key: 'owners', label: 'Owner', cardinality: 'singleton', columns: [] },
      {
        key: 'managers', label: 'Manager', cardinality: 'singleton', columns: [
          { key: 'hire_date', label: 'Hire date', type: 'date', required: false },
          { key: 'active', label: 'Active', type: 'boolean', required: true, display_in_list: true, default: true },
        ],
      },
      {
        key: 'employees', label: 'Employee', cardinality: 'multi', columns: [
          { key: 'position', label: 'Position', type: 'text', required: true, display_in_list: true },
          { key: 'hire_date', label: 'Hire date', type: 'date', required: false },
          { key: 'active', label: 'Active', type: 'boolean', required: true, display_in_list: true, default: true },
        ],
      },
      { key: 'customers', label: 'Customer', cardinality: 'multi', columns: [] },
    ],
  },

  restaurant: {
    key: 'restaurant',
    label: 'Restaurant',
    version: 1,
    roles: [
      { key: 'owners', label: 'Owner', cardinality: 'singleton', columns: [] },
      {
        key: 'managers', label: 'Manager', cardinality: 'singleton', columns: [
          { key: 'hire_date', label: 'Hire date', type: 'date', required: false },
          { key: 'active', label: 'Active', type: 'boolean', required: true, display_in_list: true, default: true },
        ],
      },
      {
        key: 'chefs', label: 'Chef', cardinality: 'multi', columns: [
          { key: 'cuisine_specialty', label: 'Specialty', type: 'text', required: false, display_in_list: true },
          { key: 'hire_date', label: 'Hire date', type: 'date', required: false },
          { key: 'active', label: 'Active', type: 'boolean', required: true, display_in_list: true, default: true },
        ],
      },
      {
        key: 'waiters', label: 'Waiter', cardinality: 'multi', columns: [
          { key: 'shift', label: 'Shift', type: 'text', required: false, display_in_list: true },
          { key: 'hire_date', label: 'Hire date', type: 'date', required: false },
          { key: 'active', label: 'Active', type: 'boolean', required: true, display_in_list: true, default: true },
        ],
      },
      { key: 'customers', label: 'Customer', cardinality: 'multi', columns: [] },
    ],
  },

  hotel: {
    key: 'hotel',
    label: 'Hotel',
    version: 1,
    roles: [
      { key: 'owners', label: 'Owner', cardinality: 'singleton', columns: [] },
      {
        key: 'managers', label: 'Manager', cardinality: 'singleton', columns: [
          { key: 'hire_date', label: 'Hire date', type: 'date', required: false },
          { key: 'active', label: 'Active', type: 'boolean', required: true, display_in_list: true, default: true },
        ],
      },
      {
        key: 'reception', label: 'Reception', cardinality: 'multi', columns: [
          { key: 'shift', label: 'Shift', type: 'text', required: false, display_in_list: true },
          { key: 'hire_date', label: 'Hire date', type: 'date', required: false },
          { key: 'active', label: 'Active', type: 'boolean', required: true, display_in_list: true, default: true },
        ],
      },
      {
        key: 'housekeeping', label: 'Housekeeping', cardinality: 'multi', columns: [
          { key: 'assigned_floor', label: 'Assigned floor', type: 'integer', required: false, display_in_list: true },
          { key: 'hire_date', label: 'Hire date', type: 'date', required: false },
          { key: 'active', label: 'Active', type: 'boolean', required: true, display_in_list: true, default: true },
        ],
      },
      {
        key: 'guests', label: 'Guest', cardinality: 'multi', columns: [
          { key: 'room_number', label: 'Room', type: 'text', required: false, display_in_list: true },
          { key: 'check_in', label: 'Check-in', type: 'date', required: false, display_in_list: true },
          { key: 'check_out', label: 'Check-out', type: 'date', required: false, display_in_list: true },
          { key: 'id_document_no', label: 'ID document', type: 'text', required: false },
        ],
      },
    ],
  },

  clinic: {
    key: 'clinic',
    label: 'Clinic',
    version: 1,
    roles: [
      {
        key: 'doctors', label: 'Doctor', cardinality: 'singleton', columns: [
          { key: 'specialty', label: 'Specialty', type: 'text', required: true, display_in_list: true },
          { key: 'license_no', label: 'License #', type: 'text', required: false },
          { key: 'years_practising', label: 'Years practising', type: 'integer', required: false },
        ],
      },
      {
        key: 'nurses', label: 'Nurse', cardinality: 'multi', columns: [
          { key: 'ward', label: 'Ward', type: 'text', required: false, display_in_list: true },
          { key: 'shift', label: 'Shift', type: 'text', required: false, display_in_list: true },
          { key: 'license_no', label: 'License #', type: 'text', required: false },
        ],
      },
      {
        key: 'staff', label: 'Staff', cardinality: 'multi', columns: [
          { key: 'position', label: 'Position', type: 'text', required: true, display_in_list: true },
          { key: 'hire_date', label: 'Hire date', type: 'date', required: false },
          { key: 'active', label: 'Active', type: 'boolean', required: true, display_in_list: true, default: true },
        ],
      },
      {
        key: 'patients', label: 'Patient', cardinality: 'multi', columns: [
          { key: 'dob', label: 'DOB', type: 'date', required: false, display_in_list: true },
          { key: 'blood_type', label: 'Blood type', type: 'text', required: false, display_in_list: true },
          { key: 'allergies', label: 'Allergies', type: 'text', required: false },
          { key: 'primary_doctor_name', label: 'Primary doctor', type: 'text', required: false },
        ],
      },
    ],
  },

  hospital: {
    key: 'hospital',
    label: 'Hospital',
    version: 1,
    roles: [
      { key: 'directors', label: 'Director', cardinality: 'singleton', columns: [] },
      {
        key: 'doctors', label: 'Doctor', cardinality: 'multi', columns: [
          { key: 'specialty', label: 'Specialty', type: 'text', required: true, display_in_list: true },
          { key: 'license_no', label: 'License #', type: 'text', required: false },
          { key: 'years_practising', label: 'Years practising', type: 'integer', required: false },
        ],
      },
      {
        key: 'nurses', label: 'Nurse', cardinality: 'multi', columns: [
          { key: 'ward', label: 'Ward', type: 'text', required: false, display_in_list: true },
          { key: 'shift', label: 'Shift', type: 'text', required: false, display_in_list: true },
          { key: 'license_no', label: 'License #', type: 'text', required: false },
        ],
      },
      {
        key: 'staff', label: 'Staff', cardinality: 'multi', columns: [
          { key: 'department', label: 'Department', type: 'text', required: false, display_in_list: true },
          { key: 'position', label: 'Position', type: 'text', required: true, display_in_list: true },
          { key: 'hire_date', label: 'Hire date', type: 'date', required: false },
          { key: 'active', label: 'Active', type: 'boolean', required: true, display_in_list: true, default: true },
        ],
      },
      {
        key: 'patients', label: 'Patient', cardinality: 'multi', columns: [
          { key: 'dob', label: 'DOB', type: 'date', required: false, display_in_list: true },
          { key: 'blood_type', label: 'Blood type', type: 'text', required: false, display_in_list: true },
          { key: 'allergies', label: 'Allergies', type: 'text', required: false },
          { key: 'admission_date', label: 'Admitted', type: 'date', required: false, display_in_list: true },
          { key: 'ward', label: 'Ward', type: 'text', required: false, display_in_list: true },
        ],
      },
    ],
  },
};
