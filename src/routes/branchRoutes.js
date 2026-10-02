// routes/branchRoutes.js (NEW FILE)
const express = require('express');
const router = express.Router();
const { 
    getAllBranches,
    getBranch,
    createBranch,
    updateBranch,
    deleteBranch,
    assignUsersToBranch,
    getUsersByBranch,
    getBranchesByUser
} = require('../controllers/branchController');

// Protected routes (require authentication)
router.get('/branches', getAllBranches);
router.get('/branches/:id', getBranch);
router.get('/branches/:id/users', getUsersByBranch);
router.get('/users/:userId/branches', getBranchesByUser);

// Super admin only routes
router.post('/branches', createBranch);
router.put('/branches/:id', updateBranch);
router.delete('/branches/:id', deleteBranch);
router.post('/branches/:id/assign', assignUsersToBranch);

module.exports = router;