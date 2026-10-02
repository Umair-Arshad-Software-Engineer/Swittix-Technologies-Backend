const db = require('../models');

const getAllBranches = async (req, res) => {
    try {
        const branches = await db.Branch.findAll({
            include: [
                {
                    model: db.User,
                    as: 'creator',
                    attributes: ['id', 'name', 'email']
                }
            ],
            order: [['id', 'DESC']]
        });

        res.json({
            success: true,
            branches
        });
    } catch (error) {
        console.error('Get branches error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

const getBranch = async (req, res) => {
    try {
        const { id } = req.params;

        const branch = await db.Branch.findByPk(id, {
            include: [
                {
                    model: db.User,
                    as: 'creator',
                    attributes: ['id', 'name', 'email']
                },
                {
                    // ✅ NEW — hasMany, not belongsToMany; no `through` needed
                    model: db.User,
                    as: 'users',
                    attributes: ['id', 'name', 'email', 'role']
                }
            ]
        });

        if (!branch) {
            return res.status(404).json({
                success: false,
                message: 'Branch not found'
            });
        }

        res.json({
            success: true,
            branch
        });
    } catch (error) {
        console.error('Get branch error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

const createBranch = async (req, res) => {
    try {
        const { name, address, phone } = req.body;

        if (!name || !address || !phone) {
            return res.status(400).json({
                success: false,
                message: 'Please provide all required fields'
            });
        }

        const branch = await db.Branch.create({
            name,
            address,
            phone,
            created_by: req.user.id
        });

        const createdBranch = await db.Branch.findByPk(branch.id, {
            include: [
                {
                    model: db.User,
                    as: 'creator',
                    attributes: ['id', 'name', 'email']
                }
            ]
        });

        res.status(201).json({
            success: true,
            message: 'Branch created successfully',
            branch: createdBranch
        });
    } catch (error) {
        console.error('Create branch error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during branch creation'
        });
    }
};

const updateBranch = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, address, phone, is_active } = req.body;

        const branch = await db.Branch.findByPk(id);
        if (!branch) {
            return res.status(404).json({
                success: false,
                message: 'Branch not found'
            });
        }

        await branch.update({ name, address, phone, is_active });

        const updatedBranch = await db.Branch.findByPk(id, {
            include: [
                {
                    model: db.User,
                    as: 'creator',
                    attributes: ['id', 'name', 'email']
                }
            ]
        });

        res.json({
            success: true,
            message: 'Branch updated successfully',
            branch: updatedBranch
        });
    } catch (error) {
        console.error('Update branch error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during branch update'
        });
    }
};

const deleteBranch = async (req, res) => {
    try {
        const { id } = req.params;

        const branch = await db.Branch.findByPk(id);
        if (!branch) {
            return res.status(404).json({
                success: false,
                message: 'Branch not found'
            });
        }

        // ✅ NEW — check users table directly instead of UserBranch
        const userCount = await db.User.count({
            where: { branch_id: id }
        });

        if (userCount > 0) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete branch with assigned users. Reassign users first.'
            });
        }

        await branch.destroy();

        res.json({
            success: true,
            message: 'Branch deleted successfully'
        });
    } catch (error) {
        console.error('Delete branch error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during branch deletion'
        });
    }
};

// ✅ REWRITTEN — assigns a SINGLE branch to MULTIPLE users (bulk update users.branch_id)
const assignUsersToBranch = async (req, res) => {
    try {
        const { id } = req.params;
        const { userIds } = req.body;

        const branch = await db.Branch.findByPk(id);
        if (!branch) {
            return res.status(404).json({
                success: false,
                message: 'Branch not found'
            });
        }

        // Step 1: unassign any user currently on this branch but not in the new list
        // (so removing someone from the checklist actually clears their branch_id)
        await db.User.update(
            { branch_id: null },
            { where: { branch_id: id } }
        );

        // Step 2: assign this branch to the selected users
        if (userIds && userIds.length > 0) {
            await db.User.update(
                { branch_id: id },
                { where: { id: userIds } }
            );
        }

        res.json({
            success: true,
            message: 'Users assigned to branch successfully'
        });
    } catch (error) {
        console.error('Assign users error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during user assignment'
        });
    }
};

const getUsersByBranch = async (req, res) => {
    try {
        const { id } = req.params;

        const branch = await db.Branch.findByPk(id, {
            include: [
                {
                    // ✅ NEW — hasMany
                    model: db.User,
                    as: 'users',
                    attributes: ['id', 'name', 'email', 'role']
                }
            ]
        });

        if (!branch) {
            return res.status(404).json({
                success: false,
                message: 'Branch not found'
            });
        }

        res.json({
            success: true,
            users: branch.users
        });
    } catch (error) {
        console.error('Get users by branch error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// ✅ REWRITTEN — returns single branch, not a list (kept response key "branch" for clarity;
// see note below about Flutter side)
const getBranchesByUser = async (req, res) => {
    try {
        const { userId } = req.params;

        const user = await db.User.findByPk(userId, {
            include: [
                {
                    model: db.Branch,
                    as: 'branch'
                }
            ]
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            branch: user.branch || null
        });
    } catch (error) {
        console.error('Get branch by user error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

module.exports = {
    getAllBranches,
    getBranch,
    createBranch,
    updateBranch,
    deleteBranch,
    assignUsersToBranch,
    getUsersByBranch,
    getBranchesByUser
};