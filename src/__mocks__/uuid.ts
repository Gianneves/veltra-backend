let counter = 0;

export const v4 = () =>
  `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

export const v7 = () =>
  `00000000-0000-7000-8000-${String(++counter).padStart(12, '0')}`;

export const validate = () => true;

export const version = () => 4;
