import multer from 'multer';
import path from 'path';

const allowedFileTypes = (process.env.ALLOWED_FILE_TYPES || '')
  .split(',')
  .map((type) => type.trim().toLowerCase())
  .filter(Boolean);

const maxFileSizeMb = Number(process.env.MAX_FILE_SIZE_MB || 10);

const storage = multer.memoryStorage();

const fileFilter: multer.Options['fileFilter'] = (
  req,
  file,
  callback
) => {
  const extension = path
    .extname(file.originalname)
    .toLowerCase()
    .replace('.', '');

  if (!allowedFileTypes.includes(extension)) {
    return callback(
      new Error(
        `Invalid file type. Allowed types: ${allowedFileTypes.join(', ')}`
      )
    );
  }

  callback(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: maxFileSizeMb * 1024 * 1024
  }
});

export default upload;