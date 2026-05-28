import { errors } from '@strapi/utils';

const { ApplicationError } = errors;

const rejectMutation = () => {
  throw new ApplicationError('Audit events are append-only.');
};

export default {
  beforeUpdate: rejectMutation,
  beforeUpdateMany: rejectMutation,
  beforeDelete: rejectMutation,
  beforeDeleteMany: rejectMutation,
};
