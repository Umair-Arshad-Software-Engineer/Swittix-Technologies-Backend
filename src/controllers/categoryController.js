// controllers/categoryController.js
const db = require('../models');

const formatCategory = (category) => {
    const json = category.toJSON();
    return {
        id: json.id,
        name: json.name,
        description: json.description || '',
        created_by: json.created_by,
        created_by_name: json.creator?.name || 'Unknown',
        created_at: json.created_at,
        updated_at: json.updated_at,
    };
};

// Get all categories
const getAllCategories = async (req, res) => {
    try {
        const categories = await db.Category.findAll({
            include: [{
                association: 'creator',
                attributes: ['name'],
                required: false,
            }],
            order: [['name', 'ASC']],
        });

        res.json({
            success: true,
            categories: categories.map(formatCategory),
        });
    } catch (error) {
        console.error('getAllCategories error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Create category
const createCategory = async (req, res) => {
    try {
        const { name, description } = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                message: 'Category name is required',
            });
        }

        const category = await db.Category.create({
            name: name.trim(),
            description: description?.trim() || '',
            created_by: req.user.id,
        });

        const full = await db.Category.findByPk(category.id, {
            include: [{ association: 'creator', attributes: ['name'], required: false }],
        });

        res.status(201).json({
            success: true,
            category: formatCategory(full),
            message: 'Category created successfully',
        });
    } catch (error) {
        console.error('createCategory error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Update category
const updateCategory = async (req, res) => {
    try {
        const category = await db.Category.findByPk(req.params.id);

        if (!category) {
            return res.status(404).json({ success: false, message: 'Category not found' });
        }

        const { name, description } = req.body;
        const updateData = {};

        if (name !== undefined) updateData.name = name.trim();
        if (description !== undefined) updateData.description = description.trim();

        await category.update(updateData);

        const full = await db.Category.findByPk(category.id, {
            include: [{ association: 'creator', attributes: ['name'], required: false }],
        });

        res.json({
            success: true,
            category: formatCategory(full),
            message: 'Category updated successfully',
        });
    } catch (error) {
        console.error('updateCategory error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Delete category
const deleteCategory = async (req, res) => {
    try {
        const category = await db.Category.findByPk(req.params.id);

        if (!category) {
            return res.status(404).json({ success: false, message: 'Category not found' });
        }

        await category.destroy();

        res.json({ success: true, message: 'Category deleted successfully' });
    } catch (error) {
        console.error('deleteCategory error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

module.exports = {
    getAllCategories,
    createCategory,
    updateCategory,
    deleteCategory,
};