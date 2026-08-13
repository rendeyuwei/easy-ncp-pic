import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const fixturePath = fileURLToPath(new URL('../../ncp-parser/test/fixtures/PICCON02.NCP', import.meta.url));

async function login(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('用户名').fill('admin');
  await page.getByLabel('密码').fill('admin-e2e-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/filters$/);
  await expect(page.getByRole('heading', { name: '滤镜', exact: true })).toBeVisible();
}

async function useResponsiveNavigation(page: Page, projectName: string, destination: '分类' | '滤镜') {
  if (projectName === 'desktop') {
    await page.getByRole('navigation', { name: '主管理导航' }).getByRole('link', { name: destination }).click();
  } else {
    await page.getByRole('button', { name: '打开导航菜单' }).click();
    await page.getByRole('navigation', { name: '移动管理导航' }).getByRole('link', { name: destination }).click();
  }
  await expect(page.getByRole('heading', { name: destination, exact: true })).toBeVisible();
}

test.describe('desktop lifecycle', () => {
  test('publishes, persists, constrains, and cleans up a real NCP filter', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The shared database lifecycle runs once on desktop.');

    const unique = `${Date.now()}-${process.pid}`;
    const categoryName = `Film E2E ${unique}`;
    const categorySlug = `film-e2e-${unique}`;
    const filterName = `PICCON02 E2E ${unique}`;
    const editedFilterName = `${filterName} Edited`;

    await login(page);
    await page.getByRole('navigation', { name: '主管理导航' }).getByRole('link', { name: '分类' }).click();
    await page.getByRole('button', { name: '新增分类' }).first().click();

    const categoryDialog = page.getByRole('dialog', { name: '新增分类' });
    await categoryDialog.getByLabel('名称').fill(categoryName);
    await categoryDialog.getByLabel('Slug（可选）').fill(categorySlug);
    await categoryDialog.getByLabel('排序').fill('11');
    await categoryDialog.getByRole('button', { name: '保存分类' }).click();
    await expect(page.getByText('分类已创建')).toBeVisible();
    await expect(page.getByRole('table', { name: '分类列表' }).getByText(categoryName)).toBeVisible();

    await page.getByRole('navigation', { name: '主管理导航' }).getByRole('link', { name: '滤镜' }).click();
    await page.getByRole('button', { name: '新增滤镜' }).first().click();

    const createDialog = page.getByRole('dialog', { name: '新增滤镜' });
    await createDialog.getByLabel('NCP 文件').setInputFiles(fixturePath);
    await expect(createDialog.getByRole('region', { name: 'NCP 详情' })).toBeVisible();
    await expect(createDialog.getByRole('status')).toContainText('当前版本支持此 NCP');
    await expect(createDialog.getByLabel('显示名称')).toHaveValue('Fuji Astia');
    await createDialog.getByLabel('显示名称').fill(filterName);
    await createDialog.getByLabel('分类').selectOption({ label: categoryName });
    await createDialog.getByRole('button', { name: '保存滤镜' }).click();
    await expect(page.getByText('滤镜已创建')).toBeVisible();

    const createdRow = page.getByRole('table', { name: '滤镜列表' }).getByRole('row').filter({ hasText: filterName });
    await expect(createdRow).toContainText(categoryName);
    await createdRow.getByRole('button', { name: `编辑${filterName}` }).click();

    const editDialog = page.getByRole('dialog', { name: '编辑滤镜' });
    await editDialog.getByLabel('显示名称').fill(editedFilterName);
    await editDialog.getByLabel('排序').fill('37');
    await editDialog.getByLabel('启用滤镜').uncheck();
    await editDialog.getByRole('button', { name: '保存滤镜' }).click();
    await expect(page.getByText('滤镜已更新')).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(/\/admin\/filters$/);
    const persistedRow = page.getByRole('table', { name: '滤镜列表' }).getByRole('row').filter({ hasText: editedFilterName });
    await expect(persistedRow).toContainText(categoryName);
    await expect(persistedRow).toContainText('已停用');
    await expect(persistedRow).toContainText('37');

    await page.getByRole('navigation', { name: '主管理导航' }).getByRole('link', { name: '分类' }).click();
    const categoryRow = page.getByRole('table', { name: '分类列表' }).getByRole('row').filter({ hasText: categoryName });
    await categoryRow.getByRole('button', { name: `删除${categoryName}` }).click();
    const blockedDeleteDialog = page.getByRole('dialog', { name: '删除分类' });
    await blockedDeleteDialog.getByRole('button', { name: '删除分类' }).click();
    await expect(blockedDeleteDialog.getByRole('alert')).toContainText('请先移动或删除该分类下的滤镜');
    await blockedDeleteDialog.getByRole('button', { name: '取消' }).click();

    await page.getByRole('navigation', { name: '主管理导航' }).getByRole('link', { name: '滤镜' }).click();
    const filterRow = page.getByRole('table', { name: '滤镜列表' }).getByRole('row').filter({ hasText: editedFilterName });
    await filterRow.getByRole('button', { name: `删除${editedFilterName}` }).click();
    await page.getByRole('dialog', { name: '删除滤镜' }).getByRole('button', { name: '删除滤镜' }).click();
    await expect(page.getByText('滤镜已删除')).toBeVisible();
    await expect(page.getByRole('table', { name: '滤镜列表' })).toHaveCount(0);

    await page.getByRole('navigation', { name: '主管理导航' }).getByRole('link', { name: '分类' }).click();
    const cleanupCategoryRow = page.getByRole('table', { name: '分类列表' }).getByRole('row').filter({ hasText: categoryName });
    await cleanupCategoryRow.getByRole('button', { name: `删除${categoryName}` }).click();
    await page.getByRole('dialog', { name: '删除分类' }).getByRole('button', { name: '删除分类' }).click();
    await expect(page.getByText('分类已删除')).toBeVisible();
    await expect(page.getByRole('table', { name: '分类列表' })).toHaveCount(0);
  });
});

test('desktop and mobile navigation retain the selected theme', async ({ page }, testInfo) => {
  await login(page);
  await useResponsiveNavigation(page, testInfo.project.name, '分类');
  await useResponsiveNavigation(page, testInfo.project.name, '滤镜');

  const initialTheme = await page.locator('html').getAttribute('data-theme');
  expect(initialTheme === 'dark' || initialTheme === 'light').toBe(true);
  const nextTheme = initialTheme === 'dark' ? 'light' : 'dark';
  await page.getByRole('button', { name: initialTheme === 'dark' ? '切换为浅色主题' : '切换为深色主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', nextTheme);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', nextTheme);
  await expect(page.getByRole('heading', { name: '滤镜', exact: true })).toBeVisible();
});
